import { trackSaharaEvent } from './analyticsTelemetry';
import { NCCallEngine } from '@nexconn/call';
import { useEffect, useRef, useState } from 'react';
import {
  NCEngine,
  DirectChannel,
  SendTextMessageParams,
  MessageHandler
} from '@nexconn/chat';

type Props = {
  missionId: string;
  token: string;
  userId: string;
  residentId: string;
  volunteerId: string | null;
};

type Entry = {
  id: string;
  text: string;
  mine: boolean;
};

let activeAppKey = '';

export default function NexconnMissionChat({
  missionId,
  token,
  userId,
  residentId,
  volunteerId
}: Props) {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('Initializing Nexconn...');
  const [messages, setMessages] = useState<Entry[]>([]);
  const [draft, setDraft] = useState('');
  const mounted = useRef(true);

  const recipient = userId === residentId
    ? volunteerId
    : residentId;

  const prefix = `[SAHARA:${missionId}] `;

  useEffect(() => {
    mounted.current = true;

    if (!recipient) {
      setConnected(false);
      setStatus('Available after volunteer assignment');
      return;
    }

    const handlerName = `sahara-${missionId}-${userId}`;

    async function start() {
      try {
        const response = await fetch('/nexconn/session', {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        if (!response.ok) {
          throw new Error(
            `Nexconn session failed: HTTP ${response.status}`
          );
        }

        const session = await response.json();
        if (!mounted.current) return;

        if (activeAppKey !== session.app_key) {
          NCCallEngine.install();
          NCEngine.initialize({
            appKey: session.app_key
          });
          activeAppKey = session.app_key;
        }

        NCEngine.addMessageHandler(
          handlerName,
          new MessageHandler({
            onMessageReceived({ messages: incoming }) {
              if (!mounted.current) return;

              for (const message of incoming) {
                const m = message as unknown as {
                  messageId?: string;
                  senderUserId?: string;
                  content?: {
                    text?: string;
                  };
                };

                const text = m.content?.text || '';

                if (!text.startsWith(prefix)) continue;
                if (m.senderUserId !== recipient) continue;

                const id = m.messageId || crypto.randomUUID();

                setMessages(previous =>
                  previous.some(item => item.id === id)
                    ? previous
                    : [...previous, {
                        id,
                        text: text.slice(prefix.length),
                        mine: false
                      }]
                );
              }
            }
          })
        );

        const result = await NCEngine.connect({
          token: session.token
        });

        if (!mounted.current) return;

        if (result.code !== 0) {
          throw new Error(
            `Nexconn connection error: ${result.code}`
          );
        }

        setConnected(true);
        window.dispatchEvent(
          new Event('sahara:nexconn-connected')
        );

        setStatus('Nexconn Chat SDK connected');
      } catch (error) {
        if (mounted.current) {
          setConnected(false);
          setStatus(
            error instanceof Error
              ? error.message
              : 'Nexconn connection failed'
          );
        }
      }
    }

    void start();

    return () => {
      mounted.current = false;
      NCEngine.removeMessageHandler(handlerName);
    };
  }, [missionId, token, userId, recipient, prefix]);

  async function sendMessage() {
    const text = draft.trim();
    if (!text || !recipient || !connected) return;

    try {
      const channel = new DirectChannel(recipient);

      const params = new SendTextMessageParams({
        text: prefix + text
      });

      const result = await channel.sendMessage(params);

      if (result.code !== 0) {
        throw new Error(
          `Nexconn send error: ${result.code}`
        );
      }

      setMessages(previous => [...previous, {
        id: crypto.randomUUID(),
        text,
        mine: true
      }]);

      trackSaharaEvent(missionId, 'message_sent', String((result as unknown as {messageId?:string}).messageId || crypto.randomUUID()));
      setDraft('');
      setStatus('Message delivered to Nexconn');
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : 'Message failed'
      );
    }
  }

  return (
    <div className="section" style={{ marginTop: 20 }}>
      <div className="section-head">
        <h2>Nexconn Mission Chat</h2>
        <span className="pill blue">
          {connected ? 'SDK CONNECTED' : 'CONNECTING'}
        </span>
      </div>

      <p className="muted tiny" role="status">
        {status}
      </p>

      <div className="chat-log" style={{ minHeight: 180 }}>
        {messages.length === 0 ? (
          <div className="empty">
            No Nexconn messages in this session.
          </div>
        ) : (
          messages.map(item => (
            <div
              key={item.id}
              className={'bubble ' + (item.mine ? 'mine' : '')}
            >
              <p>{item.text}</p>
            </div>
          ))
        )}
      </div>

      <form
        className="chat-form"
        onSubmit={event => {
          event.preventDefault();
          void sendMessage();
        }}
      >
        <input
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder="Message via Nexconn..."
          disabled={!connected}
          maxLength={1500}
        />
        <button
          className="primary"
          type="submit"
          disabled={!connected || !draft.trim()}
        >
          Send
        </button>
      </form>
    </div>
  );
}
