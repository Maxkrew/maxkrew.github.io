/* Настройки «ФФ». Адрес сервера и публичный ключ живут ТОЛЬКО здесь —
 * переезд на другой сервер = замена этого файла (ОПИСАНИЕ §11а).
 * publishable-ключ публичный по природе; данные закрывают политики RLS (db/schema.sql). */
window.SYNC_CONFIG = {
  APP_NAME: 'Fulbro',
  /* Самостоятельная регистрация складов, «14 дней бесплатно» и тарифы. Пока выключено:
     склад заводит владелец сервиса (tools/add-warehouse.js). Включить — true. */
  SELF_SIGNUP: false,
  url: 'https://cyytuutirxxtzbhmceft.supabase.co',
  key: 'sb_publishable_SyWCymje4BVOtg9Hwn5fcw_iAI2uJEq'
};
