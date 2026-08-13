import { widgetOrigin } from './widget.service.js';

// The script a customer pastes into their website.
//
// Served as a string from the backend rather than built by the frontend
// toolchain, because it has to run on someone else's page: no framework, no
// bundler runtime, no global namespace beyond one property, and no assumption
// about what else is on the page. Everything it renders lives inside a shadow
// root so the host site's CSS cannot reach in and the widget's cannot leak out.
//
// It contains no configuration at all. Branding, copy, colours, the WhatsApp
// number and the suggested questions are fetched from /widget/v1/:key/config at
// runtime, which is what makes "change a setting without reinstalling" true.
// It carries no credentials — the public widget key is the only identifier,
// and it is meant to be visible in page source.

export function widgetLoaderScript() {
  const origin = widgetOrigin();

  return `/* Spandan — Smart Website Widget loader */
(function () {
  'use strict';
  if (window.__cfpWidgetLoaded) return;
  window.__cfpWidgetLoaded = true;

  var API = ${JSON.stringify(origin)};
  var script = document.currentScript || (function () {
    var all = document.querySelectorAll('script[data-cfp-widget]');
    return all[all.length - 1];
  })();
  var KEY = script && script.getAttribute('data-cfp-widget');
  if (!KEY) return;

  var STORE = 'cfp_widget_visitor_' + KEY;
  var visitorKey = null;
  try { visitorKey = window.localStorage.getItem(STORE); } catch (e) { /* private mode */ }

  function saveVisitor(key) {
    if (!key || key === visitorKey) return;
    visitorKey = key;
    try { window.localStorage.setItem(STORE, key); } catch (e) { /* ignore */ }
  }

  function api(path, body) {
    return fetch(API + '/widget/v1/' + KEY + path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) throw new Error(data.error || ('Request failed (' + r.status + ')'));
        return data;
      });
    });
  }

  function track(type, meta) {
    try {
      var payload = JSON.stringify({ type: type, visitorKey: visitorKey, meta: meta || null });
      var url = API + '/widget/v1/' + KEY + '/event';
      // sendBeacon survives the page being closed, which is exactly when the
      // last event of a session fires.
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
      } else {
        fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true });
      }
    } catch (e) { /* analytics must never break the widget */ }
  }

  // Does the current page match the widget's path rules? Empty means everywhere.
  function pathMatches(paths) {
    if (!paths || !paths.length) return true;
    var here = window.location.pathname.replace(/\\/+$/, '') || '/';
    for (var i = 0; i < paths.length; i++) {
      var raw = String(paths[i]).trim();
      if (!raw) continue;
      var pattern = raw.replace(/\\/+$/, '') || '/';
      if (pattern.indexOf('*') === -1) {
        if (here === pattern) return true;
      } else {
        var rx = new RegExp('^' + pattern.split('*').map(function (part) {
          return part.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
        }).join('.*') + '$');
        if (rx.test(here)) return true;
      }
    }
    return false;
  }

  var isMobile = window.matchMedia('(max-width: 640px)').matches;

  api('/config').then(function (cfg) {
    if (!cfg || !cfg.enabled) return;
    if (!pathMatches(cfg.pagePaths)) return;
    if (isMobile && cfg.config.showOnMobile === false) return;
    if (!isMobile && cfg.config.showOnDesktop === false) return;
    setTimeout(function () { render(cfg); }, cfg.config.launcherDelayMs || 0);
  }).catch(function () { /* a widget that cannot load must stay invisible */ });

  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'style') node.setAttribute('style', props[k]);
      else if (k === 'text') node.textContent = props[k];
      else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2).toLowerCase(), props[k]);
      else node.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function render(cfg) {
    var c = cfg.config;
    var host = document.createElement('div');
    host.setAttribute('data-cfp-widget-root', '');
    // Fixed positioning on the host element, so the shadow tree inside never
    // has to know about the page's layout.
    host.style.cssText = 'position:fixed;z-index:2147483000;' +
      (c.position === 'bottom-left' ? 'left:20px;' : 'right:20px;') + 'bottom:20px;';
    document.body.appendChild(host);
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

    var width = c.size === 'small' ? 320 : c.size === 'large' ? 400 : 360;
    var height = c.size === 'small' ? 420 : c.size === 'large' ? 580 : 500;
    var accent = c.primaryColor || '#1EBF5E';

    root.appendChild(el('style', { text: [
      ':host,*{box-sizing:border-box}',
      '.w{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#111}',
      '.launcher{display:flex;align-items:center;gap:8px;padding:12px 18px;border:0;border-radius:999px;',
      'background:' + accent + ';color:#fff;font-size:14px;font-weight:600;cursor:pointer;',
      'box-shadow:0 6px 24px rgba(0,0,0,.22);transition:transform .15s}',
      '.launcher:hover{transform:translateY(-1px)}',
      '.panel{display:none;flex-direction:column;width:' + width + 'px;max-width:calc(100vw - 32px);',
      'height:' + height + 'px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;overflow:hidden;',
      'box-shadow:0 12px 48px rgba(0,0,0,.24);margin-bottom:12px}',
      '.panel.open{display:flex}',
      '.hd{background:' + accent + ';color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}',
      '.hd img{width:32px;height:32px;border-radius:50%;object-fit:cover;background:rgba(255,255,255,.2)}',
      '.hd .t{font-size:14px;font-weight:700;line-height:1.2}',
      '.hd .s{font-size:11px;opacity:.85}',
      '.x{margin-left:auto;background:none;border:0;color:#fff;font-size:20px;cursor:pointer;line-height:1;opacity:.9}',
      '.body{flex:1;overflow-y:auto;padding:14px;background:#f7f8fa;display:flex;flex-direction:column;gap:10px}',
      '.msg{max-width:85%;padding:10px 13px;border-radius:14px;font-size:13.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word}',
      '.msg.bot{background:#fff;border:1px solid #e6e8ec;align-self:flex-start;border-bottom-left-radius:4px}',
      '.msg.me{background:' + accent + ';color:#fff;align-self:flex-end;border-bottom-right-radius:4px}',
      '.sug{display:flex;flex-wrap:wrap;gap:6px}',
      '.sug button{padding:7px 12px;border:1px solid ' + accent + '55;background:#fff;color:' + accent + ';',
      'border-radius:999px;font-size:12.5px;cursor:pointer;font-family:inherit}',
      '.sug button:hover{background:' + accent + '11}',
      '.ft{padding:10px;border-top:1px solid #e6e8ec;background:#fff;display:flex;gap:8px;align-items:center}',
      '.ft input{flex:1;padding:10px 12px;border:1px solid #dfe2e7;border-radius:10px;font-size:13.5px;outline:none;font-family:inherit}',
      '.ft input:focus{border-color:' + accent + '}',
      '.send{width:38px;height:38px;border:0;border-radius:10px;background:' + accent + ';color:#fff;cursor:pointer;font-size:15px}',
      '.send:disabled{opacity:.5;cursor:not-allowed}',
      '.wa{display:block;width:100%;padding:11px;border:0;border-radius:10px;background:#25D366;color:#fff;',
      'font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit;text-align:center;text-decoration:none}',
      '.wrap{padding:10px;background:#fff;border-top:1px solid #e6e8ec}',
      '.form{display:flex;flex-direction:column;gap:8px}',
      '.form input{padding:9px 11px;border:1px solid #dfe2e7;border-radius:9px;font-size:13px;font-family:inherit;outline:none}',
      '.form .h{font-size:12.5px;color:#555;line-height:1.45}',
      '.form .sb{padding:10px;border:0;border-radius:9px;background:' + accent + ';color:#fff;font-weight:600;font-size:13.5px;cursor:pointer;font-family:inherit}',
      '.err{color:#c0392b;font-size:12px}',
      '.typing{font-size:12px;color:#888;font-style:italic}',
      '.credit{text-align:center;font-size:10px;color:#9aa0a6;padding:6px}',
    ].join('') }));

    var wrap = el('div', { class: 'w' });
    var panel = el('div', { class: 'panel' });
    var body = el('div', { class: 'body' });

    // ── header ──
    var head = el('div', { class: 'hd' }, [
      c.logoUrl ? el('img', { src: c.logoUrl, alt: '' }) : null,
      el('div', {}, [
        el('div', { class: 't', text: c.title || 'Chat with us' }),
        el('div', { class: 's', text: cfg.businessName || '' }),
      ]),
    ]);
    var close = el('button', { class: 'x', 'aria-label': 'Close', onclick: function () { toggle(false); } });
    close.innerHTML = '&times;';
    head.appendChild(close);

    function addMsg(text, who) {
      var m = el('div', { class: 'msg ' + who, text: text });
      body.appendChild(m);
      body.scrollTop = body.scrollHeight;
      return m;
    }

    // ── welcome ──
    addMsg(c.welcomeMessage || 'Hi! How can we help?', 'bot');

    var suggestions = el('div', { class: 'sug' });
    (c.suggestedQuestions || []).forEach(function (q) {
      suggestions.appendChild(el('button', { text: q, onclick: function () { send(q); } }));
    });
    if (cfg.ai && (c.suggestedQuestions || []).length) body.appendChild(suggestions);

    // ── whatsapp ──
    var waWrap = el('div', { class: 'wrap' });
    var waBtn = el('button', { class: 'wa', text: c.whatsappButtonText || 'Talk to Us on WhatsApp',
      onclick: function () {
        api('/handoff', { visitorKey: visitorKey, pageUrl: location.href }).then(function (r) {
          saveVisitor(r.visitorKey);
          window.open(r.url, '_blank', 'noopener');
        }).catch(function (e) { addMsg(e.message, 'bot'); });
      } });
    if (cfg.whatsapp) waWrap.appendChild(waBtn);

    // ── lead form ──
    var leadShown = false;
    function showLeadForm() {
      if (leadShown || !cfg.leadCapture.enabled) return;
      leadShown = true;
      var form = el('div', { class: 'form' });
      form.appendChild(el('div', { class: 'h', text: cfg.leadCapture.headline || '' }));
      var inputs = {};
      (cfg.leadCapture.fields || []).forEach(function (f) {
        var input = el('input', {
          type: f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : f.type === 'number' ? 'number' : 'text',
          placeholder: f.label + (f.required ? ' *' : ''),
        });
        inputs[f.key] = input;
        form.appendChild(input);
      });
      var error = el('div', { class: 'err' });
      var submit = el('button', { class: 'sb', text: 'Send', onclick: function () {
        error.textContent = '';
        submit.disabled = true;
        var values = {};
        Object.keys(inputs).forEach(function (k) { values[k] = inputs[k].value; });
        api('/lead', { visitorKey: visitorKey, fields: values, pageUrl: location.href }).then(function (r) {
          saveVisitor(r.visitorKey);
          form.remove();
          addMsg('Thanks! Our team will get back to you shortly.', 'bot');
        }).catch(function (e) {
          error.textContent = e.message;
          submit.disabled = false;
        });
      } });
      form.appendChild(error);
      form.appendChild(submit);
      var holder = el('div', { class: 'wrap' }, [form]);
      panel.insertBefore(holder, waWrap);
    }

    // ── asking ──
    var input = el('input', { placeholder: 'Ask a question…', onkeydown: function (e) {
      if (e.key === 'Enter') send(input.value);
    } });
    var sendBtn = el('button', { class: 'send', text: '→', onclick: function () { send(input.value); } });
    var foot = el('div', { class: 'ft' }, [input, sendBtn]);

    var busy = false;
    function send(text) {
      var q = String(text || '').trim();
      if (!q || busy || !cfg.ai) return;
      busy = true;
      sendBtn.disabled = true;
      input.value = '';
      suggestions.remove();
      addMsg(q, 'me');
      var typing = el('div', { class: 'typing', text: (c.assistantName || 'Assistant') + ' is typing…' });
      body.appendChild(typing);
      body.scrollTop = body.scrollHeight;

      api('/ask', { question: q, visitorKey: visitorKey, pageUrl: location.href }).then(function (r) {
        typing.remove();
        saveVisitor(r.visitorKey);
        addMsg(r.answer, 'bot');
        // The assistant came up short and this widget has a human to offer, so
        // put the WhatsApp button where the visitor is looking.
        if (r.offerHandoff && cfg.whatsapp) {
          var inline = el('div', { class: 'wrap' }, [
            el('button', { class: 'wa', text: c.whatsappButtonText || 'Talk to Us on WhatsApp', onclick: function () { waBtn.click(); } }),
          ]);
          body.appendChild(inline);
        }
        if (cfg.leadCapture.enabled && cfg.leadCapture.trigger === 'after_answer') showLeadForm();
        body.scrollTop = body.scrollHeight;
      }).catch(function (e) {
        typing.remove();
        addMsg(e.message || 'Something went wrong. Please try again.', 'bot');
      }).finally(function () {
        busy = false;
        sendBtn.disabled = false;
      });
    }

    panel.appendChild(head);
    panel.appendChild(body);
    if (cfg.ai) panel.appendChild(foot);
    panel.appendChild(waWrap);
    panel.appendChild(el('div', { class: 'credit', text: 'Powered by Spandan' }));

    // ── launcher ──
    var launcher = el('button', { class: 'launcher', onclick: function () { toggle(); } });
    launcher.appendChild(document.createTextNode(c.buttonText || 'Chat with us'));

    var open = false;
    function toggle(next) {
      open = typeof next === 'boolean' ? next : !open;
      panel.className = 'panel' + (open ? ' open' : '');
      if (open) {
        track('OPEN');
        // A WhatsApp-only widget has nothing to say — it is a button, so the
        // click goes straight through rather than opening an empty panel.
        if (cfg.type === 'WHATSAPP') { toggle(false); waBtn.click(); return; }
        if (cfg.leadCapture.enabled && cfg.leadCapture.trigger === 'before_chat') showLeadForm();
        if (cfg.ai) input.focus();
      }
    }

    wrap.appendChild(panel);
    wrap.appendChild(launcher);
    root.appendChild(wrap);
  }
})();
`;
}
