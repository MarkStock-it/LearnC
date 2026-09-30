/**
 * Design-review entry for PracticePage (the workbench). The harness HTML stubs
 * fetch: the problem loads for real, and pressing "Run tests" returns a recorded
 * crashed submission so the verdict + Execution stack + Memory modal can be
 * reviewed without a backend.
 */
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../../src/index.css';
import { PracticePage } from '../../src/pages/PracticePage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={['/problems/7']}>
      <div className="flex h-dvh flex-col overflow-hidden">
        <main className="min-h-0 flex-1 overflow-hidden">
          <Routes>
            <Route path="/problems/:problemId" element={<PracticePage />} />
          </Routes>
        </main>
      </div>
    </MemoryRouter>
  </QueryClientProvider>,
);
