import { useNavigate } from 'react-router';
import { useSaveDoc, type ProfileDoc } from '../../hooks.ts';
import { Frame } from '../../modals/Frame.tsx';

/** 复制到独立文档，保留分流关系与节点配置，不携带原文档的身份。 */
export function useProfileCopy() {
  const save = useSaveDoc('profiles', true);
  const navigate = useNavigate();
  return async (profile: ProfileDoc) => {
    let created: ProfileDoc | undefined;
    const result = await Frame.modal.prompt({ title: '复制为新订阅', label: '名称', placeholder: '填写新配置订阅的名称', initialValue: `${profile.name} 副本`, confirmLabel: '创建并编辑' }, { submit: async name => {
      const { id: _id, ...copy } = structuredClone(profile);
      created = await save.mutateAsync({ ...copy, name });
    } });
    if (result.status === 'confirmed' && created) navigate(`/profiles/${created.id}`);
  };
}
