// Dev-only: serves the mock API (dev/mock-api.ts) on :4300 for VITE_MOCK=1 npm run dev.
import http from 'node:http';
import { handle, MOCK_INFO, type MockReq, type MockRes } from './mock-api.ts';

const PORT = Number(process.env.MOCK_PORT ?? 4300); // 4000 = real API, 4100 = mock Ginesys
const i = MOCK_INFO();
http.createServer((req, res) => handle(req as unknown as MockReq, res as unknown as MockRes))
  .listen(PORT, () => console.log(`mock api on :${PORT} · retailer ${i.retailer} (invite /i/${i.invite}) · distributor ${i.distributor} · admin ${i.admin} · code ${i.code}`));
