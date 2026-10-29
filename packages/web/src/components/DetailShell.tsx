// 详情页外框：面包屑、标题、「更多」菜单（删除）、保存按钮、错误。

import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { DeleteMenu, MoreMenu, type MoreItem } from './MoreMenu.tsx';
import { Badge, Button, ErrorBox, PageHeader } from './ui.tsx';

export function DetailShell({ listPath, listLabel, isNew, name, dirty, saving, saveDisabled = false, onSave, saveError, onDelete, deleteError, deleting, onDeleteReset, deleteBody, canEdit = true, extraActions, moreItems = [], badges, children }: {
  listPath: string; listLabel: string; isNew: boolean; name: string; dirty: boolean; saving: boolean;
  saveDisabled?: boolean;
  onSave: () => void; saveError: unknown; onDelete?: () => void; deleteError?: unknown; deleting?: boolean; onDeleteReset?: () => void; deleteBody?: ReactNode; canEdit?: boolean;
  extraActions?: ReactNode; moreItems?: MoreItem[]; badges?: ReactNode; children: ReactNode;
}) {
  return (
    <>
      <PageHeader crumbs={<><Link to={listPath} className="text-muted no-underline">{listLabel}</Link> / {isNew ? '新建' : name}</>}
        title={isNew ? `新建${listLabel}` : name || '未命名'}
        actions={<>
          {extraActions}
          {!isNew && canEdit && !onDelete && moreItems.length > 0 && <MoreMenu items={moreItems} />}
          {!isNew && onDelete && canEdit && <DeleteMenu what={listLabel} name={name} body={deleteBody} error={deleteError} extra={moreItems} {...(deleting === undefined ? {} : { pending: deleting })} {...(onDeleteReset ? { onReset: onDeleteReset } : {})} onDelete={onDelete} />}
          {canEdit && <Button variant="primary" onClick={onSave} disabled={saving || saveDisabled || !dirty}>{saving ? '保存中…' : dirty ? '保存' : '已保存'}</Button>}
        </>}>
        {badges}
        {!isNew && dirty && canEdit && <Badge tone="warn">有未保存的修改</Badge>}
      </PageHeader>
      <ErrorBox error={saveError} />
      {children}
    </>
  );
}
