'use client';
import { useI18n } from '@/components/locale-provider';
export default function Loading() {
  const { t } = useI18n();
  return (
    <div role="status" className="loading-state">
      <div className="skeleton wide" />
      <p>{t('Đang tải InfoSound…')}</p>
    </div>
  );
}
