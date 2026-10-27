// The five-step progress bar along the bottom of every step scene.
import { p } from './lib/kit.js';
export function progress(step, dur) {
  const bar = document.getElementById('prog');
  bar.innerHTML = [1, 2, 3, 4, 5].map(i => `<i><b style="transform:scaleX(${i < step ? 1 : 0})"></b></i>`).join('');
  const fill = bar.children[step - 1].firstChild;
  return t => { fill.style.transform = `scaleX(${p(t, 0, dur * 0.8)})`; };
}
