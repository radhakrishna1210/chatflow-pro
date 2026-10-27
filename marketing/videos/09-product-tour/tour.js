// The tour's chrome: logo and chapter tag on top, a chapter rail along the
// bottom that fills as the film plays, so a viewer always knows where they are.
import { enter, p } from './lib/kit.js';

export const CHAPTERS = ['Intro', 'Connect', 'Templates', 'Contacts', 'Campaigns', 'Campaign AI', 'Quiz', 'Automation', 'Inbox', 'Billing', 'More', 'Why Spandan', 'Pricing', 'Start'];

export function chrome(index, duration) {
  const stage = document.querySelector('.stage');
  stage.insertAdjacentHTML('beforeend', `
    <div id="chrome-top"><span class="logo"><span class="mark">S</span>Spandan</span><span class="ch">${String(index).padStart(2, '0')} · ${CHAPTERS[index]}</span></div>
    <div id="rail">${CHAPTERS.map((c, i) => `<div class="seg${i === index ? ' on' : ''}"><div class="bar"><i style="transform:scaleX(${i < index ? 1 : 0})"></i></div><div class="lb">${c}</div></div>`).join('')}</div>`);
  const fill = document.querySelectorAll('#rail .bar i')[index];
  return t => {
    fill.style.transform = `scaleX(${p(t, 0, duration)})`;
    enter(document.getElementById('chrome-top'), t, -0.4, { y: -10, d: 0.4 });
  };
}
