// 配置订阅列表与七步新建向导入口（PRD 4.9）。

import { DocList } from '../../components/DocList.tsx';
import { Badge } from '../../components/ui.tsx';
import { useTemplates } from '../../hooks.ts';
import { ProfileWizard } from './ProfileWizard.tsx';

export function ProfileList() {
  const templates = useTemplates().data ?? [];
  return (
    <DocList kind="profiles" title="配置订阅" deleteBody="它的所有订阅链接会立即失效，客户端将无法更新。" empty="选择模板、加入节点集，就能得到一条给客户端用的订阅链接。" intro="交付给客户端的整体订阅：模板只管分流，这里填充节点、调整组与规则、配置代理链。"
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
