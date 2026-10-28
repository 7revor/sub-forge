// 配置订阅列表与七步新建向导入口（PRD 4.9）。

import { DocList } from '../../components/DocList.tsx';
import { Badge } from '../../components/ui.tsx';
import { useTemplates } from '../../hooks.ts';
import { ProfileWizard } from './ProfileWizard.tsx';

export function ProfileList() {
  const templates = useTemplates().data ?? [];
  return (
    <DocList kind="profiles" title="配置订阅" intro="交付给客户端的整体订阅：模板只管分流，这里填充节点、调整组与规则、配置代理链。"
      columns={[
        { header: '名称', cell: (p) => p.name },
        { header: '模板', cell: (p) => p.template ? <>{templates.find((t) => t.id === p.template!.id)?.name ?? p.template.id} <Badge>{p.template.follow === 'latest' ? '跟随最新' : `锁定 v${p.template.follow.pinned}`}</Badge></> : '—' },
        { header: '节点集', cell: (p) => <span className="font-mono">{p.nodeSets.length}</span> },
        { header: '代理链', cell: (p) => <span className="font-mono">{p.chains.length}</span> },
      ]} />
  );
}

export function ProfileNew() {
  return <ProfileWizard />;
}
