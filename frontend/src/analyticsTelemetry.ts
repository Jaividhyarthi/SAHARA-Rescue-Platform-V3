/** Best-effort event counters. Never include message text, identities or locations. */
export function trackSaharaEvent(
  missionId: string,
  eventType: 'message_sent' | 'audio_call_started' | 'video_call_started' | 'call_connected',
  eventId: string
): void {
  const token = localStorage.getItem('sahara_token');
  if (!token || !missionId || !eventId) return;
  void fetch('/analytics/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ mission_id: missionId, event_type: eventType, event_id: eventId })
  }).catch(() => {}); // Analytics failure must never interrupt rescue communication.
}
