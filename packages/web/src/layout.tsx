import { alertError } from './feedback.ts';
// 外壳：左侧导航（窄屏时叠在上方）+ 内容区；未登录时跳转登录页。

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { FileCode2, FolderGit2, House, Layers, Link2, ListFilter, LogOut, Menu, Monitor, Rss, Settings2, UserRound, Users, X, type LucideIcon } from 'lucide-react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { api, onUnauthorized } from './api.ts';
import { LogoMark } from './components/LogoMark.tsx';
import { cx } from './components/ui.tsx';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarSeparator } from './components/ui/sidebar.tsx';
import { useMe } from './hooks.ts';
import { setSession } from './session.ts';

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean };
const NAV: { id: string; title: string; admin?: boolean; items: NavItem[] }[] = [
  { id: 'workspace', title: '工作台', items: [{ to: '/', label: '总览', icon: House }, { to: '/profiles', label: '配置订阅', icon: Rss }] },
  { id: 'nodes', title: '节点资源', items: [{ to: '/sources', label: '订阅源', icon: Link2 }, { to: '/locals', label: '本地节点', icon: Monitor }, { to: '/collections', label: '节点组合', icon: Layers }] },
  { id: 'rules', title: '规则资源', items: [{ to: '/rule-repo', label: '规则集合', icon: FolderGit2 }, { to: '/rulesets', label: '增强集合', icon: ListFilter }] },
  { id: 'admin', title: '系统管理', admin: true, items: [{ to: '/templates', label: '模板', icon: FileCode2, end: true }, { to: '/users', label: '用户', icon: Users }, { to: '/system', label: '系统', icon: Settings2 }] },
];

function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-2 py-1">
      <LogoMark size={24} />
      <span className="font-mono text-[15px] font-semibold text-white">Sub Forge</span>
    </div>
  );
}

export function AppLayout() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  // 窄屏时导航折叠到菜单按钮里，切换页面后自动收起
  const [menuOpen, setMenuOpen] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  useEffect(() => setMenuOpen(false), [location.pathname]);

  useEffect(() => onUnauthorized(() => {
    setSession(qc, null);
    navigate('/login', { replace: true, state: { from: location.pathname } });
  }), [qc, navigate, location.pathname]);

  useEffect(()=>{
    if(!me.data)return;
    const events=new EventSource('/api/events');
    const update=()=>void qc.invalidateQueries();
    events.addEventListener('changed',update);
    events.onopen=()=>{setReconnecting(false);update();};
    events.onerror=()=>setReconnecting(true);
    return ()=>events.close();
  },[me.data?.id,qc]);

  if (me.isLoading) return <div className="p-8 text-ink-muted">加载中…</div>;
  if (!me.data) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  const isAdmin = me.data.role === 'admin';

  const logout = async () => {
    try {
      await api('POST', '/auth/logout');
      setSession(qc, null);
      navigate('/login', { replace: true });
    } catch (error) { alertError(error); }
  };

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-ground md:flex-row">
      <Sidebar collapsible="none" className="app-sidebar w-full shrink-0 overflow-hidden px-3 py-3 max-md:max-h-[65dvh] md:w-[232px] md:py-5">
        <SidebarHeader className="shrink-0 flex-row items-center justify-between p-0 pb-3">
          <Logo />
          <button type="button" aria-controls="app-navigation" aria-expanded={menuOpen} aria-label={menuOpen ? '收起菜单' : '展开菜单'} onClick={() => setMenuOpen(!menuOpen)}
            className="grid h-10 w-10 cursor-pointer place-items-center rounded-md text-nav-text outline-none hover:bg-nav-hover focus-visible:ring-2 focus-visible:ring-sidebar-ring md:hidden">
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </SidebarHeader>
        <div id="app-navigation" className={cx('min-h-0 flex-1 flex-col overflow-hidden', menuOpen ? 'flex' : 'hidden md:flex')}>
          <SidebarContent className="nav-scroll gap-5 overflow-x-hidden overscroll-contain">
            <nav aria-label="主导航" className="flex flex-col gap-5">
              {NAV.filter(g => !g.admin || isAdmin).map(g => (
                <SidebarGroup key={g.id} role="group" aria-labelledby={`nav-${g.id}`} className={cx('gap-1 p-0', g.admin && 'border-t border-sidebar-border pt-4')}>
                  <SidebarGroupLabel id={`nav-${g.id}`} className="h-5 px-2 text-[11px] font-semibold tracking-[.08em] text-[#aab3c2]">{g.title}</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu className="gap-0.5">
                      {g.items.map(it => {
                        const active = it.to === '/' || it.end ? location.pathname === it.to : location.pathname === it.to || location.pathname.startsWith(`${it.to}/`);
                        return <SidebarMenuItem key={it.to}>
                          <SidebarMenuButton asChild isActive={active} className="h-8 gap-3 px-3 text-[13px] no-underline transition-colors max-md:h-11 [&>svg]:text-[#8995a8] data-[active=true]:[&>svg]:text-[#a9c1ff] data-[active=true]:bg-nav-active data-[active=true]:font-semibold data-[active=true]:text-white">
                            <NavLink to={it.to} end={it.to === '/' || it.end}><it.icon aria-hidden="true" /><span>{it.label}</span></NavLink>
                          </SidebarMenuButton>
                        </SidebarMenuItem>;
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ))}
            </nav>
          </SidebarContent>
          <SidebarSeparator className="mx-0 mt-4" />
          <SidebarFooter className="shrink-0 gap-1 px-0 pt-3 pb-0">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.pathname === '/account'} className="h-auto min-h-10 gap-3 px-3">
                  <NavLink to="/account"><UserRound aria-hidden="true" className="text-[#8995a8]" /><span className="flex min-w-0 flex-col gap-0.5"><span className="truncate text-[13px]">{me.data.username}</span><span className="text-[11px] text-faint">{isAdmin ? '管理员' : '普通用户'}</span></span></NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton type="button" onClick={logout} className="h-9 gap-3 px-3 text-[12px] text-faint max-md:h-11"><LogOut aria-hidden="true" />退出登录</SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </div>
      </Sidebar>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {reconnecting && <div role="status" className="border-b border-line bg-amber-50 px-4 py-2 text-[12px] text-amber-800">实时连接已断开，正在重连；可刷新页面重新读取。</div>}
        <div className="page-layout">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.data?.role !== 'admin') return <div className="text-ink-muted">需要管理员权限。</div>;
  return <>{children}</>;
}
