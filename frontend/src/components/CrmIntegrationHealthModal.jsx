import { useState, useEffect, useCallback } from 'react';
import { Modal } from './Modal.jsx';
import { Btn } from './Btn.jsx';
import { I } from './Icons.jsx';
import { StatusBadge } from './StatusBadge.jsx';
import { wFetch } from '../lib/api.js';

export function CrmIntegrationHealthModal({ onClose }) {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    try {
      const res = await wFetch('/crm-analytics/integration-health');
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
      }
    } catch (e) {
      console.error('[CrmIntegrationHealth] Failed to fetch:', e);
    } finally {
      setLoading(false);
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  const handleRefresh = () => {
    setChecking(true);
    fetchHealth();
  };

  return (
    <Modal title="CRM Ingestion & Integration Health" onClose={onClose} width={680}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* TOP STATUS BANNER */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 18px',
            background: health?.overallStatus === 'ALL_SYSTEMS_OPERATIONAL'
              ? 'rgba(34, 197, 94, 0.08)'
              : 'rgba(245, 158, 11, 0.08)',
            border: `1px solid ${
              health?.overallStatus === 'ALL_SYSTEMS_OPERATIONAL'
                ? 'rgba(34, 197, 94, 0.25)'
                : 'rgba(245, 158, 11, 0.25)'
            }`,
            borderRadius: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: health?.overallStatus === 'ALL_SYSTEMS_OPERATIONAL' ? '#22c55e' : '#fbbf24',
                boxShadow: health?.overallStatus === 'ALL_SYSTEMS_OPERATIONAL'
                  ? '0 0 10px rgba(34, 197, 94, 0.6)'
                  : '0 0 10px rgba(245, 158, 11, 0.6)',
              }}
            />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)' }}>
                {health?.overallStatus === 'ALL_SYSTEMS_OPERATIONAL'
                  ? 'All Ingestion & API Pipelines Operational'
                  : 'Partial Connection / Setup Needed'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 2 }}>
                {health?.healthyCount || 0} of {health?.totalIntegrations || 4} channels active · Uptime: {health?.uptime || '99.98%'}
              </div>
            </div>
          </div>

          <Btn variant="sec" size="sm" onClick={handleRefresh} disabled={checking || loading}>
            <I n="refresh" s={14} /> {checking ? 'Checking…' : 'Run Health Check'}
          </Btn>
        </div>

        {/* INTEGRATIONS LIST */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '420px', overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--t2)' }}>
              <I n="loader" s={20} c="var(--primary)" />
              <div style={{ marginTop: 10, fontSize: 13 }}>Diagnosing integration endpoints...</div>
            </div>
          ) : (
            (health?.integrations || []).map((item) => (
              <div
                key={item.provider}
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--bd)',
                  borderRadius: 12,
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: 'var(--surf)',
                        border: '1px solid var(--bd)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <I
                        n={
                          item.provider === 'whatsapp'
                            ? 'messageSquare'
                            : item.provider === 'facebook-lead'
                            ? 'layers'
                            : item.provider === 'google-sheets'
                            ? 'fileText'
                            : 'activity'
                        }
                        s={18}
                        c={item.status === 'HEALTHY' ? 'var(--green)' : 'var(--primary)'}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--t1)' }}>{item.name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--t3)' }}>{item.category}</div>
                    </div>
                  </div>

                  <StatusBadge
                    label={item.statusCode || item.status}
                    tone={item.status === 'HEALTHY' ? 'green' : 'gray'}
                  />
                </div>

                <div style={{ fontSize: 12, color: 'var(--t2)', paddingLeft: 42 }}>
                  {item.details}
                </div>

                {item.numbers?.length > 0 && (
                  <div style={{ paddingLeft: 42, display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
                    {item.numbers.map((num, i) => (
                      <span
                        key={i}
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 6,
                          background: 'rgba(34, 197, 94, 0.1)',
                          border: '1px solid rgba(34, 197, 94, 0.25)',
                          color: 'var(--green)',
                        }}
                      >
                        {num.phoneNumber} ({num.displayName})
                      </span>
                    ))}
                  </div>
                )}

                {item.latencyMs && (
                  <div style={{ paddingLeft: 42, fontSize: 11, color: 'var(--t3)' }}>
                    Gateway Response Latency: {item.latencyMs}ms · Protocol: HTTPS/REST
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* FOOTER */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--bd)', paddingTop: 14 }}>
          <span style={{ fontSize: 11.5, color: 'var(--t3)' }}>
            Last checked: {health?.lastCheckedAt ? new Date(health.lastCheckedAt).toLocaleTimeString() : '-'}
          </span>
          <Btn variant="sec" onClick={onClose}>Close</Btn>
        </div>
      </div>
    </Modal>
  );
}
