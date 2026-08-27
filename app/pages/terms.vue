<script setup lang="ts">
import { useI18n } from '#imports'

definePageMeta({ layout: 'default' })

const { locale } = useI18n()

useSeoMeta({
  title: () => (locale.value === 'uz' ? 'Foydalanish shartlari · Memour' : 'Условия использования · Memour'),
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
          <span class="text-gradient-gold">Foydalanish shartlari</span>
        </h1>
        <div class="prose prose-stone mt-8 max-w-none">
          <p><strong>Kuchga kirgan sana:</strong> 2026-yil may oyi.</p>

          <h2>1. Xizmat tavsifi</h2>
          <p>Memour — toʻylar uchun mehmon suratlarini yigʻish platformasi. Biz mijozga QR-kod, mehmon yuklash sahifasi, dashboard va arxiv yuklab olish imkoniyatini taqdim etamiz.</p>

          <h2>2. Tarif va toʻlov</h2>
          <p>Tariflar saytda koʻrsatilgan. Toʻlov bir martalik, har bir tadbir uchun alohida. Toʻlov oʻtgandan keyin tadbir aktivlashtiriladi va mehmonlar suratlar yuborishi mumkin boʻladi.</p>

          <h2>3. Mehmon kontenti</h2>
          <p>Mehmonlar yuborgan suratlar kelin-kuyov muvaffaqiyati uchun yigʻiladi. Suratlar:</p>
          <ul>
            <li>Faqat tadbir kuni ±18 soat oraliqida qabul qilinadi.</li>
            <li>Geofence radiusi ichida boʻlishi kerak.</li>
            <li>Kelin-kuyov noo&apos;rin suratlarni yashirish (modaratsiya) huquqiga ega.</li>
          </ul>

          <h2>4. Cheklovlar</h2>
          <p>Quyidagi mazmunni yuklash taqiqlanadi: noqonuniy, haqoratli, pornografik, zoʻravonlik tashviqoti, intellektual mulk huquqlarini buzuvchi.</p>

          <h2>5. Pul qaytarish</h2>
          <p>Tadbir kunidan oldin pul qaytarish soʻrash mumkin (xizmat hali boshlanmagan). Tadbir oʻtkazilgandan keyin pul qaytarilmaydi.</p>

          <h2>6. Mas&apos;uliyat</h2>
          <p>Memour mehmon kontenti uchun mas&apos;ul emas. Texnik nosozliklar yuz berganda biz tezda tiklashga harakat qilamiz, lekin internet provayderi sabab boʻlgan ishdamasliklarga javob bermaymiz.</p>

          <h2>7. Bogʻlanish</h2>
          <p>Savol va shikoyatlar: <a href="mailto:hello@memour.uz">hello@memour.uz</a>.</p>
        </div>
      </div>

      <div v-else>
        <p class="mb-2 text-xs uppercase tracking-[0.3em] text-(--color-muted-foreground)">
          Memour
        </p>
        <h1 class="heading-display-md italic">
          <span class="text-gradient-gold">Условия использования</span>
        </h1>
        <div class="prose prose-stone mt-8 max-w-none">
          <p><strong>Дата вступления в силу:</strong> май 2026 г.</p>

          <h2>1. Описание сервиса</h2>
          <p>Memour — платформа для сбора фото гостей на свадьбе. Мы предоставляем клиенту QR-коды, гостевую страницу загрузки, дашборд пары и скачивание архива.</p>

          <h2>2. Тарифы и оплата</h2>
          <p>Тарифы указаны на сайте. Оплата — разовая, отдельная за каждое событие. После прохождения платежа событие активируется и гости могут отправлять фото.</p>

          <h2>3. Гостевой контент</h2>
          <p>Фото, отправленные гостями, собираются в альбом пары. Загрузка:</p>
          <ul>
            <li>Доступна только в день свадьбы ±18 часов.</li>
            <li>Только в пределах геофенса (радиус площадки).</li>
            <li>Пара имеет право скрыть (модерировать) неподходящие фото.</li>
          </ul>

          <h2>4. Запрещённый контент</h2>
          <p>Запрещено загружать: незаконный, оскорбительный, порнографический контент, контент, пропагандирующий насилие, нарушающий права интеллектуальной собственности.</p>

          <h2>5. Возврат средств</h2>
          <p>Возврат возможен до даты события (услуга ещё не оказана). После проведения свадьбы возврат не производится.</p>

          <h2>6. Ответственность</h2>
          <p>Memour не несёт ответственности за гостевой контент. При технических сбоях мы оперативно восстанавливаем работу, но не отвечаем за перебои на стороне интернет-провайдеров.</p>

          <h2>7. Контакты</h2>
          <p>Вопросы и жалобы: <a href="mailto:hello@memour.uz">hello@memour.uz</a>.</p>
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
