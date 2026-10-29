import { Link, useLocation } from 'react-router';
import { GithubTokenSettings } from '../components/GithubTokenSettings.tsx';
import { Card, PageHeader, PageScroll, buttonClass } from '../components/ui.tsx';

export function RuleRepoSettingsPage() {
  const { search } = useLocation();
  const back = `/rule-repo${search}`;
  return <>
    <PageHeader title="GitHub Token" crumbs={<><Link to={back} className="text-muted hover:text-accent">规则仓库</Link> / GitHub Token</>}
      actions={<Link to={back} className={buttonClass()}>返回列表</Link>} />
    <PageScroll><Card title="GitHub API 认证"><GithubTokenSettings /></Card></PageScroll>
  </>;
}
