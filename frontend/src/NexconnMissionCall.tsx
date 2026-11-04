import { useCallback, useEffect, useRef, useState } from 'react';
import {
  NCCallEngine,
  NCCallType,
  NCCallMediaType
} from '@nexconn/call';

type Props = {
  missionId: string;
  userId: string;
  residentId: string;
  volunteerId: string | null;
  enabled: boolean;
};

type Incoming = {
  callId: string;
};

type CallEngine = ReturnType<typeof NCCallEngine.initialize>;

let sharedCallEngine: CallEngine | null = null;
let initializedForUser = '';

const callReadyEvent = 'sahara:nexconn-connected';

export default function NexconnMissionCall({
  missionId,
  userId,
  residentId,
  volunteerId,
  enabled
}: Props) {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Connecting to Nexconn calling...');
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [calling, setCalling] = useState(false);

  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const engine = useRef<CallEngine | null>(null);
  const currentCallId = useRef<string | null>(null);

  const recipient = userId === residentId
    ? volunteerId
    : residentId;

  const bindVideo = useCallback(() => {
    const nc = engine.current;

    if (!nc || !recipient) return;

    if (localVideo.current) {
      nc.setLocalVideoView({
        videoElement: localVideo.current
      });
    }

    if (remoteVideo.current) {
      nc.setRemoteVideoView([{
        userId: recipient,
        videoElement: remoteVideo.current
      }]);
    }
  }, [recipient]);

  useEffect(() => {
    if (!enabled || !recipient) {
      setReady(false);
      setStatus('Calling available after volunteer assignment');
      return;
    }

    let disposed = false;

    function setup() {
      if (disposed || !enabled) return;

      try {
        if (!sharedCallEngine || initializedForUser !== userId) {
          sharedCallEngine = NCCallEngine.initialize({});
          initializedForUser = userId;
        }

        const nc = sharedCallEngine!;
        engine.current = nc;

        if (localVideo.current) {
          nc.setLocalVideoView({
            videoElement: localVideo.current
          });
        }

        if (remoteVideo.current) {
          nc.setRemoteVideoView([{
            userId: recipient!,
            videoElement: remoteVideo.current
          }]);
        }

        nc.setCallEventHandler({
          onCallReceived(event) {
            if (disposed) return;

            const id = event.session.getCallId();
            currentCallId.current = id;
            setIncoming({ callId: id });
            setCallId(id);
            setCalling(false);
            setStatus('Incoming Nexconn call');
          },

          onCallConnected(event) {
            if (disposed) return;

            const id = event.session.getCallId();
            currentCallId.current = id;
            setCallId(id);
            setIncoming(null);
            setCalling(false);
            setConnected(true);
            setStatus('Nexconn call connected');
          },

          onCallEnded() {
            if (disposed) return;

            currentCallId.current = null;
            setCallId(null);
            setIncoming(null);
            setConnected(false);
            setCalling(false);
            setStatus('Call ended — ready');
          },

          onRemoteUserStateChanged() {
            if (!disposed) {
              setStatus(previous =>
                previous === 'Starting Nexconn call...'
                  ? previous
                  : 'Nexconn participant state updated'
              );
            }
          }
        });

        setReady(true);
        setStatus('Nexconn Call SDK ready');
      } catch (error) {
        setReady(false);
        setStatus(
          error instanceof Error
            ? error.message
            : 'Nexconn Call SDK initialization failed'
        );
      }
    }

    window.addEventListener(callReadyEvent, setup);

    return () => {
      disposed = true;
      window.removeEventListener(callReadyEvent, setup);
      if (engine.current) {
        engine.current.setCallEventHandler({
          onCallReceived: () => {},
          onCallConnected: () => {},
          onCallEnded: () => {}
        });
      }
    };
  }, [enabled, recipient, userId, missionId]);

  async function startCall(video: boolean) {
    const nc = engine.current;

    if (!nc || !recipient || !enabled || calling) return;

    try {
      bindVideo();
      setCalling(true);
      setStatus('Starting Nexconn call...');

      const result = await nc.startCall({
        calleeIds: [recipient],
        callType: NCCallType.SINGLE,
        mediaType: video
          ? NCCallMediaType.AUDIO_VIDEO
          : NCCallMediaType.AUDIO,
        extra: JSON.stringify({ missionId })
      });

      if (result.code !== 0) {
        throw new Error(`Call failed: ${result.code}`);
      }

      if (result.callId) {
        currentCallId.current = result.callId;
        setCallId(result.callId);
      }

      setStatus(video ? 'Video call ringing...' : 'Audio call ringing...');
    } catch (error) {
      setCalling(false);
      setStatus(
        error instanceof Error ? error.message : 'Unable to start call'
      );
    }
  }

  async function accept() {
    const nc = engine.current;

    if (!nc || !incoming) return;

    try {
      bindVideo();

      const result = await nc.acceptCall({
        callId: incoming.callId
      });

      if (result.code !== 0) {
        throw new Error(`Answer failed: ${result.code}`);
      }

      setIncoming(null);
      setStatus('Connecting media...');
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Unable to answer call'
      );
    }
  }

  async function hangup() {
    const nc = engine.current;
    const id = currentCallId.current || callId;

    if (!nc || !id) return;

    try {
      const result = await nc.endCall({ callId: id });

      if (result.code !== 0) {
        throw new Error(`Hang-up failed: ${result.code}`);
      }

      currentCallId.current = null;
      setCallId(null);
      setIncoming(null);
      setConnected(false);
      setCalling(false);
      setStatus('Call ended');
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Unable to end call'
      );
    }
  }

  return (
    <div className="section action-panel">
      <div className="section-head">
        <h2>Private Nexconn Call</h2>
        <span className="pill blue">
          {connected ? 'IN CALL' : ready ? 'SDK READY' : 'CONNECTING'}
        </span>
      </div>

      <p className="muted tiny">
        Secure mission audio and video communication using Nexconn Call SDK.
      </p>

      <p role="status" style={{ marginBottom: 14 }}>
        {status}
      </p>

      {incoming && (
        <div
          style={{
            padding: 14,
            borderRadius: 12,
            background: '#edf9f4',
            marginBottom: 14
          }}
        >
          <strong>Incoming mission call</strong>

          <div
            style={{
              display: 'flex',
              gap: 10,
              marginTop: 12
            }}
          >
            <button
              type="button"
              className="primary"
              onClick={() => void accept()}
            >
              Answer
            </button>

            <button
              type="button"
              className="outline"
              onClick={() => void hangup()}
            >
              Decline
            </button>
          </div>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          marginBottom: 14
        }}
      >
        <button
          type="button"
          className="primary"
          disabled={!ready || !!callId || calling}
          onClick={() => void startCall(false)}
        >
          Audio call
        </button>

        <button
          type="button"
          className="outline"
          disabled={!ready || !!callId || calling}
          onClick={() => void startCall(true)}
        >
          Video call
        </button>

        <button
          type="button"
          className="danger-outline"
          disabled={!callId}
          onClick={() => void hangup()}
        >
          Hang up
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 10
        }}
      >
        <video
          ref={localVideo}
          autoPlay
          muted
          playsInline
          style={{
            width: '100%',
            minHeight: 155,
            background: '#102135',
            borderRadius: 12,
            objectFit: 'cover'
          }}
        />

        <video
          ref={remoteVideo}
          autoPlay
          playsInline
          style={{
            width: '100%',
            minHeight: 155,
            background: '#102135',
            borderRadius: 12,
            objectFit: 'cover'
          }}
        />
      </div>

      <p className="muted tiny" style={{ marginTop: 12 }}>
        Camera and microphone permissions are requested when needed.
        Calling requires both participants to be connected to Nexconn.
      </p>
    </div>
  );
}
