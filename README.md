# SAHARA Rescue Intelligence — Independent v2 application

A new, polished React + FastAPI humanitarian community assistance **prototype**, packaged independently of the previous SAHARA repository.

## Features actually implemented

- Responsive resident, volunteer and coordinator workspaces
- Email/password registration and login (coordinator created by local script)
- SOS submission with opt-in browser GPS and nearby offer creation (15 km, presence age <=15 minutes)
- Volunteer availability, SOS offer inbox, accept mission
- Role-based mission visibility and state transitions
- Dark interactive command map (Leaflet + CARTO/OSM tiles)
- Resident and volunteer mission markers; optional live volunteer GPS updates
- Public OSRM demo driving-distance / duration estimate when available
- Private mission messages using database storage and 12-second polling
- Resident verification and 100 volunteer recognition points per verified mission
- Safety center, mission overview and status counters

## Quick start (Ubuntu / WSL)

### Backend
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# IMPORTANT: edit JWT_SECRET in .env before sharing or deploying
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Create coordinator account from another terminal in `backend` with activated virtual environment:
```bash
python create_coordinator.py
```

### Frontend
```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```
Open http://localhost:5173. API documentation: http://127.0.0.1:8000/docs.

## Safety and production limitations

**NOT FOR LIVE EMERGENCIES.** The software does not contact dispatch, ambulance, police, or fire services. For India call 112 in an emergency.

This is a high-fidelity development build, **not a sale-ready or safety-certified product**. Before commercial deployment, it requires: independent security review, privacy/data retention design and consent records, migrations and database backups, rate limiting, abuse detection, account verification, coordinator/volunteer vetting, incident escalation, monitoring, real-world reliability testing, accessibility testing, location accuracy and battery testing, legal review, proper routing and mapping SLAs, background tracking strategy, secure audit logs, concurrency-safe offer claims, notification delivery, and load testing.

The app **does not include** Nexconn SDK voice/video calling, Nexconn messaging, push notifications, AI dispatch, road-route drawing on the map, or production-grade real-time location streaming. Messages are database-backed with polling; routing estimates use the public OSRM demo and are not guaranteed. The front end's map uses third-party map tiles; verify commercial licensing and service terms before selling.

No secret credentials are bundled. Do not copy your existing Neon, Nexconn, or JWT secrets into source control.

## v3 communication extension (added)
- Browser WebRTC audio/video calling through an authenticated, mission-scoped FastAPI WebSocket signaling endpoint. This is **not** the Nexconn Call SDK. Both participants must have the same active mission open; the recipient must accept. Media is not recorded. Some networks require a separately provisioned TURN server. Calls have not been validated on two remote devices.
- Opt-in standards-based browser push notifications using VAPID, a service worker, and `pywebpush`. Push can notify volunteers of new nearby SOS offers, residents when a volunteer accepts, and participants of new messages. Push requires HTTPS (except localhost), user permission, and configured VAPID keys. Delivery has not been tested with a real browser subscription.
- Mission position records are deleted on cancellation, resident confirmation, or volunteer completion report; older positions are withheld from the API after two minutes.

### Generate credentials (Ubuntu)
```bash
cd backend
python3 -c 'import secrets; print(secrets.token_urlsafe(48))' # put in JWT_SECRET
# after installing requirements:
vapid --gen # if the pywebpush command is unavailable, use the py-vapid CLI after installing py-vapid
```
Do not put the JWT secret, database password, or VAPID private key in the frontend. TURN credentials in Vite variables are exposed to clients; for production, issue short-lived TURN credentials from a server endpoint.

### What still blocks commercial launch
This is not certified or validated as an emergency response system. Required work includes reliable managed routing/tiles, scalable persistent signaling, cross-device and network call testing, production TURN credentials, abuse/rate limits, email verification and recovery, coordinator identity checks, audit logs, database migrations, notification delivery testing, background GPS architecture on supported mobile platforms, monitoring, backups, accessibility testing, privacy and consent review, penetration testing, and operational incident response. Native mobile push (FCM/APNs) and Nexconn SDK-specific calling are not included. No live response guarantee should be advertised.
