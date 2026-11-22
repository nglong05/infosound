'use client';
import { useI18n } from '@/components/locale-provider';
export default function Error({ reset }: { reset: () => void }) {
  const { t } = useI18n();
  return (
    <section className="state-box" role="alert">
      <h1>{t('Chưa thể mở trang này')}</h1>
      <p>{t('Đã có lỗi xảy ra. Vui lòng thử tải lại nội dung.')}</p>
      <button className="button" onClick={reset}>
        {t('Thử lại')}
      </button>
    </section>
  );
}
