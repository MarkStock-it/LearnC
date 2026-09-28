/**
 * Design-review entry for GeneratePage. Renders the real page component as-is;
 * the harness HTML (post-processed after the build) seeds a fake session and
 * stubs fetch, so no backend is needed. ?key=1 shows the own-Gemini-key state
 * (model select + rpm note); the default shows the no-key nudge.
 */
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../../src/index.css';
import { GeneratePage } from '../../src/pages/GeneratePage';

createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/generate']}>
    <GeneratePage />
  </MemoryRouter>,
);
