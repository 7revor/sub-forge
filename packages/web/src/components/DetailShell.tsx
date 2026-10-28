// 详情页外框：面包屑、标题、保存按钮、错误、底部删除。

import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { deleteErrorText } from './DocList.tsx';
import { Button, ErrorBox, PageHeader } from './ui.tsx';

export function DetailShell({ listPath, listLabel, isNew, name, dirty, saving, onSave, saveError, onDelete, deleteError, canEdit = true, extraActions, badges, children }: {
  listPath: string; listLabel: string; isNew: boolean; name: string; dirty: boolean; saving: boolean;
  onSave: () => void; saveError: unknown; onDelete?: () => void; deleteError?: unknown; canEdit?: boolean;
  extraActions?: ReactNode; badges?: ReactNode; children: ReactNode;
}) {
  return (
    <>
      <PageHeader crumbs={<><Link to={listPath} className="text-muted no-underline">{listLabel}</Link> / {isNew ? '新建' : name}</>}
        title={isNew ? `新建${listLabel}` : name || '未命名'}
        actions={<>{extraActions}{canEdit && <Button variant="primary" onClick={onSave} disabled={saving || !dirty}>{saving ? '保存中…' : dirty ? '保存' : '已保存'}</Button>}</>}>
        {badges}
      </PageHeader>
      <ErrorBox error={saveError} />
      {children}
      {!isNew && onDelete && canEdit && (
        <div className="flex flex-col items-start gap-2">
          <Button variant="danger" onClick={onDelete}>删除</Button>
          {deleteError ? <ErrorBox error={deleteErrorText(deleteError)} /> : null}
        </div>
      )}
    </>
  );
}
