<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useLocalePath } from '#imports'

definePageMeta({ layout: 'admin' })

/**
 * Admin — create event form. Posts to /api/admin/events which inserts
 * the row and optionally invites the couple by email (creating an
 * auth user + sending magic link automatically).
 *
 * Query params (when navigated from `/admin/leads → создать событие`):
 *   couple_names, owner_phone (9 digits), wedding_date, table_count,
 *   from_lead — id of the originating lead, which we mark as
 *   converted + linked to the new event on success.
 */
const localePath = useLocalePath()
const router = useRouter()
const route = useRoute()

const couple_names = ref('')
const wedding_date = ref<string | null>(null)
const venue_name = ref('')
const owner_email = ref('')
const owner_phone = ref('+998 ')
const owner_phone_digits = ref('')
const table_count = ref(10)
const plan_tier = ref<'basic' | 'pro' | 'premium' | 'luxury'>('basic')
const status = ref<'draft' | 'active'>('draft')
const fromLeadId = ref<string | null>(null)

// Prefill from query params (set by the /admin/leads → создать кнопка).
onMounted(() => {
  const q = route.query
  if (typeof q.couple_names === 'string') couple_names.value = q.couple_names
  if (typeof q.wedding_date === 'string') wedding_date.value = q.wedding_date
  if (typeof q.owner_phone === 'string' && /^\d{9}$/.test(q.owner_phone)) {
    owner_phone_digits.value = q.owner_phone
    owner_phone.value = `+998 ${q.owner_phone}`
  }
  if (typeof q.table_count === 'string') {
    const n = parseInt(q.table_count, 10)
    if (Number.isFinite(n)) table_count.value = n
  }
  if (typeof q.from_lead === 'string' && /^[0-9a-f-]{36}$/i.test(q.from_lead)) {
    fromLeadId.value = q.from_lead
  }
})

const pending = ref(false)
const error = ref<string | null>(null)

async function submit() {
  if (!wedding_date.value) {
    error.value = 'Укажите дату свадьбы'
    return
  }
  error.value = null
  pending.value = true
  try {
    const res = await $fetch<{ ok: boolean; event: { id: string } }>(
      '/api/admin/events',
      {
        method: 'POST',
        body: {
          couple_names: couple_names.value,
          wedding_date: wedding_date.value,
          venue_name: venue_name.value || null,
          owner_email: owner_email.value || null,
          owner_phone: owner_phone_digits.value.length === 9
            ? `+998${owner_phone_digits.value}`
            : null,
          table_count: table_count.value,
          plan_tier: plan_tier.value,
          status: status.value,
        },
      },
    )
    if (res.ok) {
      // If we came from a lead, mark it as converted + linked.
      if (fromLeadId.value) {
        await $fetch(`/api/admin/leads/${fromLeadId.value}`, {
          method: 'PATCH',
          body: { status: 'won', converted_event_id: res.event.id },
        }).catch(() => { /* best-effort */ })
      }
      router.push(localePath('/admin'))
    }
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? e?.message ?? 'Ошибка'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <h1 class="heading-display-md mb-6">Создать событие</h1>

    <form class="surface-card flex flex-col gap-5 rounded-(--radius-xl) p-7" @submit.prevent="submit">
      <div class="flex flex-col gap-1.5">
        <label class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">Имена пары</label>
        <input
          v-model="couple_names"
          type="text"
          required
          minlength="2"
          maxlength="120"
          placeholder="Алиса и Дамир"
          class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
        >
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div class="flex flex-col gap-1.5">
          <label class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">Дата свадьбы</label>
          <MarketingDatePicker v-model="wedding_date" />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">Кол-во столов</label>
          <input
            v-model.number="table_count"
            type="number"
            min="1"
            max="200"
            class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
          >
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">Площадка</label>
        <input
          v-model="venue_name"
          type="text"
          maxlength="160"
          placeholder="Lokomotiv Wedding Hall"
          class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
        >
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">Телефон пары</label>
        <MarketingPhoneInput
          v-model="owner_phone"
          v-model:digits="owner_phone_digits"
        />
        <p class="text-[11px] text-(--color-muted-foreground)">
          Когда пара зайдёт через SMS-вход — это событие автоматически привяжется к их аккаунту.
        </p>
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">Email пары (опционально)</label>
        <input
          v-model="owner_email"
          type="email"
          placeholder="couple@example.com"
          class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
        >
        <p class="text-[11px] text-(--color-muted-foreground)">
          Если указать — отправим magic-link на email параллельно с SMS-вариантом.
        </p>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div class="flex flex-col gap-1.5">
          <label class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">Тариф</label>
          <select
            v-model="plan_tier"
            class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm"
          >
            <option value="basic">Basic</option>
            <option value="pro">Pro</option>
            <option value="premium">Premium</option>
            <option value="luxury">Luxury</option>
          </select>
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">Статус</label>
          <select
            v-model="status"
            class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm"
          >
            <option value="draft">Черновик (ждёт оплаты)</option>
            <option value="active">Активно (оплачено)</option>
          </select>
        </div>
      </div>

      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

      <div class="flex gap-3">
        <NuxtLink
          :to="localePath('/admin')"
          class="inline-flex h-11 flex-1 items-center justify-center rounded-md border border-(--color-border) bg-white text-sm hover:bg-(--color-muted)"
        >Отмена</NuxtLink>
        <button
          type="submit"
          :disabled="pending"
          class="inline-flex h-11 flex-1 items-center justify-center rounded-md bg-(--color-primary) text-sm font-medium text-(--color-primary-foreground) hover:opacity-90 disabled:opacity-60"
        >{{ pending ? 'Создаём…' : 'Создать' }}</button>
      </div>
    </form>
  </div>
</template>
