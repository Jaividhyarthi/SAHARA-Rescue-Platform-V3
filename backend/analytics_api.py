"""Protected aggregate analytics routes for SAHARA.

No account names, emails, message bodies or coordinates leave these routes.
The event endpoint records only counted SDK milestones after client success.
"""
from __future__ import annotations

import hashlib
import hmac
import os
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import Column, DateTime, ForeignKey, String, func, select
from sqlalchemy.exc import IntegrityError


class SDKEventInput(BaseModel):
    mission_id: str = Field(min_length=4, max_length=100)
    event_type: Literal['message_sent', 'audio_call_started', 'video_call_started', 'call_connected']
    event_id: str = Field(min_length=4, max_length=180)


def install_analytics_routes(app, Base, SessionLocal, User, Mission, Presence, Offer, Chat, current, dbs):
    class AnalyticsEvent(Base):
        __tablename__ = 'analytics_sdk_events'
        # Deterministic identifier deduplicates two clients reporting one call.
        id = Column(String(64), primary_key=True)
        event_type = Column(String(40), nullable=False, index=True)
        mission_id = Column(String, ForeignKey('missions.id'), nullable=False)
        actor_role = Column(String(24), nullable=False)
        created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    def gate(value: str | None):
        expected = os.getenv('ANALYTICS_SHARED_KEY', '').strip()
        if not expected:
            raise HTTPException(503, 'Analytics not configured')
        if not value or not hmac.compare_digest(value, expected):
            raise HTTPException(403, 'Forbidden')

    def count(db, model, *clauses):
        q = select(func.count()).select_from(model)
        if clauses:
            q = q.where(*clauses)
        return int(db.scalar(q) or 0)

    def iso(dt):
        if not dt:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')

    @app.get('/analytics/summary')
    def analytics_summary(x_analytics_key: str | None = Header(None)):
        gate(x_analytics_key)
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=29)
        presence_cutoff = now - timedelta(minutes=15)
        with SessionLocal() as db:
            users = count(db, User)
            residents = count(db, User, User.role == 'resident')
            volunteers = count(db, User, User.role == 'volunteer')
            coordinators = count(db, User, User.role == 'coordinator')
            total = count(db, Mission)
            statuses = {str(k or 'unknown'): int(v) for k, v in db.execute(select(Mission.status, func.count()).group_by(Mission.status))}
            categories = sorted(
                [{'name': str(k or 'Other'), 'value': int(v)} for k, v in db.execute(select(Mission.category, func.count()).group_by(Mission.category))],
                key=lambda x: (-x['value'], x['name'])
            )
            priorities = {str(k or 'unknown'): int(v) for k, v in db.execute(select(Mission.priority, func.count()).group_by(Mission.priority))}
            active_volunteers = count(db, Presence, Presence.available == 'yes', Presence.updated_at >= presence_cutoff)
            pending_offers = count(db, Offer, Offer.status == 'pending')
            accepted_offers = count(db, Offer, Offer.status == 'accepted')
            verified = statuses.get('confirmed', 0)
            completed_or_pending_confirmation = verified + statuses.get('reported_complete', 0)
            # This is the count of the *legacy SAHARA database chat* only;
            # Nexconn messages are separately reflected by instrumented events.
            legacy_chat_records = count(db, Chat)
            event_counts = {str(k): int(v) for k, v in db.execute(select(AnalyticsEvent.event_type, func.count()).group_by(AnalyticsEvent.event_type))}
            daily_users = {str(day): int(v) for day, v in db.execute(
                select(func.date(User.created_at), func.count()).where(User.created_at >= cutoff).group_by(func.date(User.created_at))
            )} if hasattr(User, 'created_at') else {}
            # Existing User model has no registration timestamp. Never fabricate signup history.
            daily_missions = {str(day): int(v) for day, v in db.execute(
                select(func.date(Mission.created_at), func.count()).where(Mission.created_at >= cutoff).group_by(func.date(Mission.created_at))
            )}
            daily_verified = {str(day): int(v) for day, v in db.execute(
                select(func.date(Mission.created_at), func.count()).where(Mission.created_at >= cutoff, Mission.status == 'confirmed').group_by(func.date(Mission.created_at))
            )}
            daily_events = {}
            for day, kind, n in db.execute(
                select(func.date(AnalyticsEvent.created_at), AnalyticsEvent.event_type, func.count())
                .where(AnalyticsEvent.created_at >= cutoff)
                .group_by(func.date(AnalyticsEvent.created_at), AnalyticsEvent.event_type)
            ):
                daily_events.setdefault(str(day), {})[str(kind)] = int(n)

            recent = []
            for category, status, priority, created_at in db.execute(
                select(Mission.category, Mission.status, Mission.priority, Mission.created_at)
                .order_by(Mission.created_at.desc()).limit(7)
            ):
                recent.append({'category': category or 'Other', 'status': status or 'unknown',
                               'priority': priority or 'standard', 'created_at': iso(created_at)})

            dates = [(now.date() - timedelta(days=(29-i))).isoformat() for i in range(30)]
            timeline = [{'date': day, 'requests': daily_missions.get(day, 0),
                         'verified_requests_created': daily_verified.get(day, 0),
                         'messages': daily_events.get(day, {}).get('message_sent', 0),
                         'audio_calls': daily_events.get(day, {}).get('audio_call_started', 0),
                         'video_calls': daily_events.get(day, {}).get('video_call_started', 0)}
                        for day in dates]

            return {
                'source': 'SAHARA production database',
                'generated_at': iso(now),
                'period_days': 30,
                'users': {'total': users, 'residents': residents, 'volunteers': volunteers,
                          'coordinators': coordinators, 'active_volunteers_15m': active_volunteers},
                'missions': {'total': total, 'status': statuses, 'by_category': categories,
                             'by_priority': priorities, 'verified': verified,
                             'reported_or_verified': completed_or_pending_confirmation},
                'offers': {'pending': pending_offers, 'accepted': accepted_offers},
                'sdk_events': event_counts,
                'legacy_chat_records': legacy_chat_records,
                'timeline': timeline,
                'recent_missions': recent,
                'notes': [
                    'Counts are actual database records, not demo fixtures.',
                    'Daily account signup history is unavailable because the current User schema has no registration timestamp.',
                    'Nexconn message and call counts begin after optional client instrumentation is deployed; historical SDK events cannot be reconstructed.',
                    'A verified mission means resident-confirmed, not an externally audited rescue.',
                    'Volunteer active means available and last updated within 15 minutes, not an online socket count.',
                    'The last 30 days show mission creation dates, not actual resolution timestamps.'
                ]
            }

    @app.post('/analytics/event', status_code=202)
    def analytics_event(p: SDKEventInput, u=Depends(current)):
        # This route uses the normal SAHARA bearer token; no shared analytics secret is sent to a browser.
        if not os.getenv('ANALYTICS_SHARED_KEY', '').strip():
            raise HTTPException(503, 'Analytics not configured')
        with SessionLocal() as db:
            m = db.get(Mission, p.mission_id)
            if not m or u.id not in (m.resident_id, m.volunteer_id):
                raise HTTPException(403, 'Not a mission participant')
            if not m.volunteer_id:
                raise HTTPException(409, 'Mission not assigned')
            # event_id is an SDK event identifier; storing only its hash avoids raw call identifiers.
            identifier = hashlib.sha256((p.event_type + ':' + p.event_id).encode('utf-8')).hexdigest()
            db.add(AnalyticsEvent(id=identifier, event_type=p.event_type, mission_id=p.mission_id,
                                  actor_role=u.role, created_at=datetime.now(timezone.utc)))
            try:
                db.commit()
                return {'recorded': True}
            except IntegrityError:
                db.rollback()
                return {'recorded': False, 'duplicate': True}
