// 手动验收：写入一个规则集和一个管理员，供备份恢复验收。
//   SUBFORGE_DB=/临时目录/sub-forge.db tsx test/manual-backup-server.ts
import { Cipher, hashPassword, loadMasterKey } from '../src/crypto.ts';
import { Store } from '../src/store.ts';

const dbPath = process.env.SUBFORGE_DB;
if (!dbPath) throw new Error('请设置 SUBFORGE_DB');
const store = new Store(dbPath, { cipher: new Cipher(loadMasterKey(dbPath, undefined)) });
const admin = store.createUser({ username: 'admin', passwordHash: await hashPassword(process.env.SUBFORGE_ADMIN_PASSWORD ?? 'manual-admin-pass'), role: 'admin' });
store.put('ruleset', { id: 'manual', name: '验收规则集', sources: [{ id: 's', kind: 'local', format: 'auto', content: 'DOMAIN,example.com' }] }, admin.id);
store.close();
