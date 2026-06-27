# Звонки: почему «1 из 10» и как починить (TURN/coturn)

## Вывод аудита

**Код WebRTC исправен.** `web/src/services/webrtcManager.ts` корректно: ставит
ICE-кандидатов в очередь до remoteDescription (trickle ICE), обрабатывает
offer/answer без гонок, закрывает соединение, имеет таймауты. Сигнализация в
`socket/socketServer.js` и `hooks/useSocket.ts` тоже корректна.

**«1 из 10» — это классическая сигнатура неработающего TURN-relay.** Звонок
соединяется ТОЛЬКО когда у обоих абонентов есть прямой путь (одна сеть /
«дружелюбный» NAT). Как только оба за симметричным NAT (а это почти все мобильные
операторы), нужен **relay через TURN-сервер**, и если TURN не работает —
соединение не устанавливается. ~10% успеха = доля «удачных» сетей.

> Это **не баг приложения**, а конфигурация TURN-сервера (coturn на VDsina) и/или
> переменных окружения. Чинится на сервере, как ранее CORS бакета.

## Как подтвердить за 1 минуту (браузерная консоль)

Во время звонка открой DevTools → Console. Код уже логирует диагностику:

1. `[WebRTC] ICE config: N servers total, M TURN`
   - **M = 0** → TURN не отдаётся бэкендом (не выставлены env). См. §«ENV».
2. Ищи строки `✅ RELAY candidate via TURN@...`
   - **Нет ни одного RELAY** → coturn недоступен или отвергает аутентификацию.
3. При неудаче — строка `[WebRTC] Had relay candidates: false`
   - подтверждает: relay не сгенерировался → проблема в TURN, не в коде.

## Прямой тест TURN (вне приложения)

1. Открой https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
2. Введи свой TURN URL (напр. `turn:<vdsina-ip>:3478`) + username/credential.
   - Креды можно взять из ответа `GET /calls/ice-servers` (DevTools → Network).
3. «Gather candidates». **Должна появиться строка типа `relay`.**
   - Нет `relay` → coturn настроен/доступен неправильно (см. чек-лист ниже).

## Чек-лист coturn на VDsina (самое частое)

```ini
# /etc/turnserver.conf
listening-port=3478
tls-listening-port=5349
fingerprint
use-auth-secret
static-auth-secret=<ТО ЖЕ значение, что METERED_TURN_SECRET в env бэкенда>
realm=<твой-домен-или-ip>
# ВАЖНО: внешний IP VDsina (без него relay отдаёт приватный адрес)
external-ip=<публичный-IP-VDsina>
# Диапазон relay-портов — должен совпадать с тем, что открыт в firewall
min-port=49152
max-port=65535
```

**Firewall VDsina (это причина №1 «работает на одной сети, не работает на другой»):**
открыть входящие:
- `3478/udp` и `3478/tcp` (TURN/STUN)
- `5349/tcp` (TURN over TLS)
- **`49152-65535/udp`** — диапазон relay-портов (если закрыт — ALLOCATE проходит,
  а медиа не идёт → звонок «иногда» соединяется, иногда нет).

## ENV бэкенда (Amvera)

Поиск идёт по приоритету (см. `routes/calls.js`). Рекомендуемый путь — HMAC:

```
METERED_TURN_SECRET=<static-auth-secret из turnserver.conf>
TURN_URLS=turn:<vdsina-ip>:3478,turn:<vdsina-ip>:3478?transport=tcp,turns:<домен>:5349
STUN_URLS=stun:<vdsina-ip>:3478          # свой STUN (Google STUN в РФ заблокирован РКН)
```

- **Обязательно укажи TCP и TLS-варианты** в `TURN_URLS`, не только UDP: на части
  мобильных/корпоративных сетей UDP-3478 заблокирован, спасает `turns:5349` (TLS,
  выглядит как обычный HTTPS).
- `METERED_TURN_SECRET` + `static-auth-secret` в coturn **должны совпадать байт-в-байт**.

## Замечание по коду (мелочь, не корень проблемы)

В `webrtcManager.getIceServers()` запасной вариант при сбое запроса — только
Google STUN (`stun.l.google.com`), который в РФ заблокирован РКН. Это срабатывает
лишь если падает запрос `/calls/ice-servers` (редко), но в РФ такой фолбэк
бесполезен. Можно заменить на свой STUN. На «1 из 10» НЕ влияет (основной путь
берёт конфиг с бэкенда).

## Порядок действий

1. Подтвердить причину по консоли (нет RELAY-кандидатов).
2. Прямой тест TURN через Trickle ICE.
3. Выровнять `static-auth-secret` ↔ `METERED_TURN_SECRET`, `external-ip`,
   **открыть relay-порты в firewall**, добавить TCP+TLS в `TURN_URLS`.
4. Повторить тест Trickle ICE → дождаться `relay`.
5. Проверить звонок между двумя телефонами на РАЗНЫХ сетях (моб. ↔ Wi-Fi).
