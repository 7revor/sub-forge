import { Link } from 'react-router';
import { boundTemplateId, modeLabel } from './routing.ts';
// 配置订阅列表与七步新建向导入口（PRD 4.9）。

import { DocList } from '../../components/DocList.tsx';
import { Badge } from '../../components/ui.tsx';
import { useTemplates } from '../../hooks.ts';
import { ProfileWizard } from './ProfileWizard.tsx';

export function ProfileList() {
  const templates = useTemplates().data ?? [];
  return (
    <DocList kind="profiles" title="配置订阅" intro={<Link to="/profiles/import-loon" className="text-brand">导入 Loon 完整配置</Link>} deleteBody="它的订阅链接会立即失效，客户端将无法更新。"
      columns={[
        { header: '名称', cell: (p) => p.name },
        { header: '模式', cell: (p) => <Badge>{modeLabel(p, templates.find(t => t.id === boundTemplateId(p))?.name)}</Badge> },
        { header: '节点集', cell: (p) => <span className="font-mono">{p.nodeSets.length}</span> },
        { header: '代理链', cell: (p) => <span className="font-mono">{p.chains.length}</span> },
      ]} />
  );
}

export function ProfileNew() {
  return <ProfileWizard />;
}
