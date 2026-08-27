<script setup lang="ts">
import { useI18n } from '#imports'

definePageMeta({ layout: 'default' })

const { locale } = useI18n()

useSeoMeta({
  title: () => (locale.value === 'uz' ? 'Maxfiylik siyosati · Memour' : 'Политика конфиденциальности · Memour'),
  description: () => (locale.value === 'uz' ? 'Memour qanday maʼlumotlarni yigʻadi va saqlaydi' : 'Какие данные Memour собирает и хранит'),
})
</script>

<template>
  <article class="container-page relative py-16 sm:py-24">
    <div class="mx-auto max-w-3xl">
      <div v-if="locale === 'uz'">
        <p class="mb-2 text-xs uppercase tracking-[0.3em] text-(--color-muted-foreground)">
          Memour
        </p>
        <h1 class="heading-display-md italic">
          <span class="text-gradient-gold">Maxfiylik siyosati</span>
        </h1>
        <div class="prose prose-stone mt-8 max-w-none text-(--color-foreground)">
          <p><strong>Oxirgi yangilanish:</strong> 2026-yil may oyi.</p>

          <h2>1. Biz qaysi maʼlumotlarni yigʻamiz</h2>
          <ul>
            <li><strong>Aloqa maʼlumotlari:</strong> ism, telefon raqami, email — siz roʻyxatdan oʻtganda yoki ariza qoldirganda.</li>
            <li><strong>Tadbir maʼlumotlari:</strong> kelin-kuyov ismlari, sana, joy, mehmonlar soni.</li>
            <li><strong>Mehmon fayllari:</strong> mehmonlar yuborgan suratlar, videolar va ovozli xabarlar.</li>
            <li><strong>Texnik:</strong> IP-manzil, brauzer, qurilma turi — xavfsizlik va spam-himoya uchun.</li>
          </ul>

          <h2>2. Qanday foydalanamiz</h2>
          <p>Maʼlumotlar faqat xizmatni taqdim etish uchun ishlatiladi: tadbiringizni yaratish, mehmon suratlarini saqlash, hisobingizga kirish kodlarini yuborish.</p>

          <h2>3. Saqlash muddati</h2>
          <p>Tadbir suratlari va videolari to&apos;y kunidan 6 oygacha saqlanadi, soʻngra avtomatik oʻchiriladi. Aloqa maʼlumotlari hisobingiz mavjud boʻlguncha saqlanadi.</p>

          <h2>4. Uchinchi tomonlar</h2>
          <p>Biz maʼlumotlaringizni quyidagi xizmatlar bilan baham koʻramiz:</p>
          <ul>
            <li><strong>Supabase</strong> — baza va fayl saqlash.</li>
            <li><strong>Eskiz.uz</strong> — SMS-kod yuborish.</li>
            <li><strong>Payme / Click</strong> — toʻlovlar.</li>
            <li><strong>Telegram</strong> — bildirishnomalar.</li>
          </ul>

          <h2>5. Sizning huquqlaringiz</h2>
          <p>Siz istalgan vaqtda hisobingizni va barcha maʼlumotlaringizni oʻchirish soʻrovini yubora olasiz. Buning uchun yozing: <a href="mailto:hello@memour.uz">hello@memour.uz</a>.</p>

          <h2>6. Cookie-lar</h2>
          <p>Biz sessiya cookie-laridan foydalanamiz (kirishni saqlash uchun) va til tanlovi cookie-lari. Reklama yoki kuzatuv cookie-lari yoʻq.</p>

          <h2>7. Bogʻlanish</h2>
          <p>Savollar boʻlsa: <a href="mailto:hello@memour.uz">hello@memour.uz</a>.</p>
        </div>
      </div>

      <div v-else>
        <p class="mb-2 text-xs uppercase tracking-[0.3em] text-(--color-muted-foreground)">
          Memour
        </p>
        <h1 class="heading-display-md italic">
          <span class="text-gradient-gold">Политика конфиденциальности</span>
        </h1>
        <div class="prose prose-stone mt-8 max-w-none text-(--color-foreground)">
          <p><strong>Последнее обновление:</strong> май 2026 г.</p>

          <h2>1. Какие данные мы собираем</h2>
          <ul>
            <li><strong>Контактные данные:</strong> имя, телефон, email — при регистрации или подаче заявки.</li>
            <li><strong>Данные события:</strong> имена пары, дата, площадка, количество гостей.</li>
            <li><strong>Файлы гостей:</strong> фото, видео и голосовые сообщения, отправленные гостями свадьбы.</li>
            <li><strong>Технические:</strong> IP-адрес, браузер, тип устройства — для безопасности и анти-спам защиты.</li>
          </ul>

          <h2>2. Как мы используем</h2>
          <p>Данные используются исключительно для предоставления сервиса: создания вашего события, хранения гостевых фото, отправки кодов входа в кабинет.</p>

          <h2>3. Срок хранения</h2>
          <p>Фото и видео события хранятся до 6 месяцев после даты свадьбы, затем автоматически удаляются. Контактные данные хранятся пока существует ваш аккаунт.</p>

          <h2>4. Третьи стороны</h2>
          <p>Мы передаём данные следующим сервисам:</p>
          <ul>
            <li><strong>Supabase</strong> — база данных и хранилище файлов.</li>
            <li><strong>Eskiz.uz</strong> — отправка SMS с кодом.</li>
            <li><strong>Payme / Click</strong> — обработка платежей.</li>
            <li><strong>Telegram</strong> — уведомления.</li>
          </ul>

          <h2>5. Ваши права</h2>
          <p>Вы можете в любой момент запросить удаление аккаунта и всех ваших данных. Напишите: <a href="mailto:hello@memour.uz">hello@memour.uz</a>.</p>

          <h2>6. Cookie</h2>
          <p>Мы используем сессионные cookie (для сохранения входа) и cookie выбора языка. Рекламных или трекинговых cookie у нас нет.</p>

          <h2>7. Контакты</h2>
          <p>Вопросы: <a href="mailto:hello@memour.uz">hello@memour.uz</a>.</p>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
@reference "~/assets/css/main.css";

.prose h2 { @apply mt-8 mb-2 font-display text-2xl italic; }
.prose p { @apply mb-3 text-(--color-muted-foreground); }
.prose ul { @apply mb-3 ml-6 list-disc space-y-1 text-(--color-muted-foreground); }
.prose strong { @apply text-(--color-foreground) font-medium; }
.prose a { @apply text-(--color-primary) underline decoration-(--color-primary)/40 underline-offset-2; }
</style>
