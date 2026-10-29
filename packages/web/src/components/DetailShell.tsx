// 详情页外框：面包屑、标题、平铺操作按钮、保存按钮、最右侧的删除按钮、错误。

import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { DeleteAction, ActionButtons, type ActionItem } from './DetailActions.tsx';
import { Badge, Button, ErrorAlert, PageHeader, PageScroll } from './ui.tsx';

export function DetailShell({ listPath, listLabel, isNew, name, dirty, saving, saveDisabled = false, onSave, saveError, onDelete, deleteError, deleting, onDeleteReset, deleteBody, canEdit = true, extraActions, actionItems = [], badges, children }: {
  listPath: string; listLabel: string; isNew: boolean; name: string; dirty: boolean; saving: boolean;
  saveDisabled?: boolean;
  onSave: () => void; saveError: unknown; onDelete?: () => void; deleteError?: unknown; deleting?: boolean; onDeleteReset?: () => void; deleteBody?: ReactNode; canEdit?: boolean;
  extraActions?: ReactNode; actionItems?: ActionItem[]; badges?: ReactNode; children: ReactNode;
}) {
  return (
    <>
      <PageHeader crumbs={<><Link to={listPath} className="text-muted no-underline">{listLabel}</Link> / {isNew ? '新建' : name}</>}
        title={isNew ? `新建${listLabel}` : name || '未命名'}
        actions={<>
          {extraActions}
          {!isNew && canEdit && actionItems.length > 0 && <ActionButtons items={actionItems} />}
          {canEdit && <Button variant="primary" onClick={onSave} disabled={saving || saveDisabled || !dirty}>{saving ? '保存中…' : dirty ? '保存' : '已保存'}</Button>}
          {!isNew && onDelete && canEdit && <DeleteAction what={listLabel} name={name} body={deleteBody} error={deleteError} {...(deleting === undefined ? {} : { pending: deleting })} {...(onDeleteReset ? { onReset: onDeleteReset } : {})} onDelete={onDelete} />}
        </>}>
        {badges}
        {!isNew && dirty && canEdit && <Badge tone="warn">有未保存的修改</Badge>}
      </PageHeader>
      <ErrorAlert error={saveError} />
      <PageScroll>{children}</PageScroll>
    </>
  );
}
