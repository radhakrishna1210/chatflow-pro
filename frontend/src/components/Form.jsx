const fieldStyle = {
  width: '100%', padding: '9px 12px', borderRadius: 8,
  background: 'rgba(255,255,255,0.04)', border: '1px solid var(--bd)',
  color: 'var(--t1)', fontSize: 13, fontFamily: "'Plus Jakarta Sans',sans-serif",
  outline: 'none', boxSizing: 'border-box',
};

// These fields highlight their own border on focus. That must not cost the
// caller their own onFocus/onBlur: an earlier version defined both internally
// and silently dropped anything passed in, so a handler that saved on blur
// never ran and the failure was invisible.
const withFocusRing = (handler, paint) => (e) => {
  e.target.style.borderColor = paint;
  handler?.(e);
};

const focusRing = (onFocus) => withFocusRing(onFocus, 'var(--gbd)');
const blurRing = (onBlur) => withFocusRing(onBlur, 'var(--bd)');

export const FLabel = ({ children, required }) => (
  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--t2)', letterSpacing: '.04em', marginBottom: 6 }}>
    {children} {required && <span style={{ color: '#f87171' }}>*</span>}
  </label>
);

export const FInput = ({ value, onChange, placeholder, type = 'text', onKeyDown, onFocus, onBlur, disabled, min, max, step, ...rest }) => (
  <input
    type={type} value={value ?? ''} onChange={onChange} placeholder={placeholder}
    onKeyDown={onKeyDown} disabled={disabled} min={min} max={max} step={step}
    style={{ ...fieldStyle, opacity: disabled ? .6 : 1 }}
    onFocus={focusRing(onFocus)} onBlur={blurRing(onBlur)}
    {...rest} />
);

export const FSelect = ({ value, onChange, options = [], disabled, placeholder, onFocus, onBlur, ...rest }) => (
  <select
    value={value ?? ''} onChange={onChange} disabled={disabled}
    style={{ ...fieldStyle, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .6 : 1 }}
    onFocus={focusRing(onFocus)} onBlur={blurRing(onBlur)}
    {...rest}>
    {placeholder && <option value="">{placeholder}</option>}
    {options.map(o => (
      <option key={o.value} value={o.value} style={{ background: 'var(--surf)', color: 'var(--t1)' }}>
        {o.label}
      </option>
    ))}
  </select>
);

export const FTextarea = ({ value, onChange, placeholder, rows = 4, disabled, onFocus, onBlur, ...rest }) => (
  <textarea
    value={value ?? ''} onChange={onChange} placeholder={placeholder} rows={rows} disabled={disabled}
    style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.5, opacity: disabled ? .6 : 1 }}
    onFocus={focusRing(onFocus)} onBlur={blurRing(onBlur)}
    {...rest} />
);
