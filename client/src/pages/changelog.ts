import './page';
import { CHANGELOG } from '../changelog';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

document.getElementById('changelog')!.innerHTML = CHANGELOG.map((release) => `
  <section class="page-release">
    <h2>${escapeHtml(release.version)} · ${escapeHtml(release.title)}</h2>
    <p class="page-date">${escapeHtml(release.date)}</p>
    <ul>${release.changes.map((change) => `<li>${escapeHtml(change)}</li>`).join('')}</ul>
  </section>`).join('');
