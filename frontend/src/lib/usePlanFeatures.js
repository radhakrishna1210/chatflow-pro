import { useEffect, useState } from 'react';
import { wFetch } from './api.js';

// Which plan features this workspace has (GET /subscription/features, the
// flags in backend services/planFeatures.service.js). Screens use it to
// disable what the plan does not include instead of letting the click 403;
// the server enforces every flag regardless.
//
// `features` is null until loaded, and stays null if the request fails, so
// callers treat "unknown" as allowed and let the server have the last word.
export function usePlanFeatures() {
  const [features, setFeatures] = useState(null);
  useEffect(() => {
    let alive = true;
    wFetch('/subscription/features')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.features) setFeatures(d.features); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const allows = (flag) => features == null || features[flag] !== false;
  return { features, allows };
}
