// In-memory semantics for the WorkflowRun writes the engine makes, shared by
// the tests that run the real engine against a fake store. Only the operators
// the engine uses are supported: equality (incl. Dates and null), `in`, `lte`,
// `OR`, and `{ increment }` in data.

const DEFAULTS = { version: 0, resumeAt: null };

const valueOf = (row, key) => (row[key] === undefined ? DEFAULTS[key] : row[key]);

export function matchRunWhere(row, where = {}) {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return cond.some((sub) => matchRunWhere(row, sub));
    const value = valueOf(row, key);
    if (cond === null) return value == null;
    if (cond instanceof Date) return value != null && new Date(value).getTime() === cond.getTime();
    if (typeof cond === 'object') {
      if ('in' in cond) return cond.in.includes(value);
      if ('lte' in cond) return value != null && new Date(value).getTime() <= new Date(cond.lte).getTime();
      return false;
    }
    return value === cond;
  });
}

export function applyRunData(row, data = {}) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && !(value instanceof Date) && 'increment' in value) {
      row[key] = (valueOf(row, key) ?? 0) + value.increment;
    } else {
      row[key] = value instanceof Date ? new Date(value) : structuredClone(value);
    }
  }
  return row;
}

// `rows()` returns the live run objects of the fake store.
export function updateManyRuns(rows, { where, data }) {
  let count = 0;
  for (const row of rows()) {
    if (matchRunWhere(row, where)) { applyRunData(row, data); count += 1; }
  }
  return { count };
}
