# РЖАВЫЙ СИГНАЛ / RUST SIGNAL

**Браузерная игра для размещения на VPS.**

`/` — главная страница · `/play/` — игра · `/api/` — онлайн-рейтинг (для установок с API)

> [!NOTE]
> **🤖 100% AI-GENERATED PROJECT**
>
> Весь репозиторий — исходный код, игровая логика, графика, интерфейс, документация и скрипты установки — полностью создан с использованием искусственного интеллекта.
>
> **От идеи до реализации — AI-generated.**

> [!TIP]
> **📦 Установка на Ubuntu, Debian, CentOS Stream и FreeBSD**
>
> **[Открыть полную инструкцию по установке и обновлению →](./INSTALL.md)**
>
> Ниже — четыре сценария установки с примерами команд для Linux. Для команд и отличий конкретных ОС используйте `INSTALL.md`.

## Навигация

[Выбор способа](#выбор-способа-установки) · [Новый сайт](#way-1) · [Замена сайта](#way-2) · [Только файлы](#way-3) · [Nginx stream/SNI](#way-4) · [Онлайн-рейтинг](#leaderboard)

---

## Выбор способа установки

| Ситуация на сервере | Способ | Общий рейтинг |
| :--- | :--- | :---: |
| Чистый VPS или свободный домен на существующем Nginx | **[1. Новый сайт](#way-1)** | ✅ |
| На домене есть отдельный Nginx-сайт, который нужно заменить | **[2. Замена сайта](#way-2)** | ✅ |
| Есть готовый веб-каталог; настройки Nginx, VPN и HTTPS менять нельзя | **[3. Только файлы](#way-3)** | — |
| Nginx `stream` принимает TCP/443 и направляет SNI `default` на внутренний HTTPS Nginx | **[4. Stream/SNI](#way-4)** | ✅ |

> [!IMPORTANT]
> **Выберите только один способ установки.**
>
> Команды выполняются **в терминале VPS** с правами `sudo` или `root`. В примерах `game.example.com` — условный домен: замените его своим. Адреса загрузки скриптов GitHub менять не нужно.

<a id="way-1"></a>

## 1. Новый сайт на обычном Nginx

**Подходит для:** чистого VPS или сервера, где выбранный домен ещё не используется другим сайтом.

Установщик добавляет недостающие зависимости, собирает игру, настраивает Nginx и запускает общий рейтинг.

**Заменить:** `game.example.com` на свой домен с DNS-записью, указывающей на VPS.

### Установка с доменом

```sh
DOMAIN='game.example.com'
curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/vps.sh -o /tmp/rust-signal-vps.sh
sudo sh /tmp/rust-signal-vps.sh install "$DOMAIN"
```

<details>
<summary><strong>Установка без домена — по IP (HTTP)</strong></summary>

```sh
curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/vps.sh -o /tmp/rust-signal-vps.sh
sudo sh /tmp/rust-signal-vps.sh install
```

</details>

### Обновление

```sh
curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/vps.sh -o /tmp/rust-signal-vps.sh
sudo sh /tmp/rust-signal-vps.sh update
```

> [!NOTE]
> Установщик создаёт **HTTP-сайт**. Сертификат и HTTPS автоматически не настраиваются.

---

<a id="way-2"></a>

## 2. Замена существующего сайта на домене

**Подходит для:** домена, который уже обслуживает **отдельный Nginx-сайт**, если прежний сайт больше не нужен.

Установщик создаёт резервную копию конфигураций, сохраняет существующие порты и настройки TLS, затем устанавливает игру и общий рейтинг.

**Заменить:** `game.example.com` на домен заменяемого сайта.

### Установка

```sh
DOMAIN='game.example.com'
curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/replace-domain.sh -o /tmp/rust-signal-replace.sh
sudo sh /tmp/rust-signal-replace.sh "$DOMAIN"
```

### Обновление

После замены используйте **`vps.sh update`**, а не повторный запуск `replace-domain.sh`.

```sh
curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/vps.sh -o /tmp/rust-signal-vps.sh
sudo sh /tmp/rust-signal-vps.sh update
```

> [!WARNING]
> Не подходит для общего `default_server`, смешанных конфигураций нескольких доменов или нестандартных VPN-маршрутов.
>
> Если у прежнего сайта был отдельный `location /.well-known/acme-challenge/`, восстановите его в новом Nginx-конфиге: установщик пока не переносит этот маршрут, что может нарушить продление TLS-сертификата.

---

<a id="way-3"></a>

## 3. Только файлы сайта — без изменений Nginx

**Подходит для:** сервера с уже настроенными сайтом, веб-каталогом и маршрутизацией.

Этот способ заменяет только файлы игры. **Nginx, сертификаты и порты не изменяются.**

**Требования к каталогу:** уже существует, содержит `index.html` и не содержит посторонних файлов, кроме `.well-known`.

| Параметр | Что заменить |
| :--- | :--- |
| `DOMAIN` | `game.example.com` → свой домен |
| `WEBROOT` | `/var/www/example-game` → полный путь к существующему веб-каталогу (директива `root` веб-сервера) |

### Установка

```sh
DOMAIN='game.example.com'
WEBROOT='/var/www/example-game'
curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/selfmask-webroot.sh -o /tmp/rust-signal-webroot.sh
sudo sh /tmp/rust-signal-webroot.sh install "$DOMAIN" "$WEBROOT"
```

### Обновление

Укажите **те же домен и веб-каталог**.

```sh
DOMAIN='game.example.com'
WEBROOT='/var/www/example-game'
curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/selfmask-webroot.sh -o /tmp/rust-signal-webroot.sh
sudo sh /tmp/rust-signal-webroot.sh update "$DOMAIN" "$WEBROOT"
```

> [!NOTE]
> **Онлайн-рейтинг отдельно:** этот способ не устанавливает API. Для общего рейтинга нужно отдельно подключить `/api/` к серверной части.

---

<a id="way-4"></a>

## 4. Существующий Nginx stream/SNI-шлюз

**Подходит для:** сервера, где **Nginx stream** принимает публичный TCP/443, а `default` существующей SNI-карты направляет соединения на **внутренний HTTPS-порт Nginx**.

Не используйте этот способ, если `default` ведёт в Reality либо TCP/443 обслуживает другая программа.

### Какие значения заменить

| Переменная | Что указать |
| :--- | :--- |
| `DOMAIN` | Домен игры |
| `HTTPS_PORT` | **Уже работающий** внутренний HTTPS-порт Nginx; `8443` — пример |
| `CERT` | Полный путь к существующему `fullchain.pem` этого домена |
| `KEY` | Полный путь к соответствующему `privkey.pem` |
| `MAP_NAME` | Имя переменной из `map $ssl_preread_server_name $tls_routes` (например, `tls_routes`), **без знака `$`** |

### Установка

```sh
DOMAIN='game.example.com'
HTTPS_PORT='8443'
CERT='/etc/ssl/example-game/fullchain.pem'
KEY='/etc/ssl/example-game/privkey.pem'
MAP_NAME='tls_routes'

curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/stream-default-site.sh -o /tmp/rust-signal-stream.sh
sudo sh /tmp/rust-signal-stream.sh install "$DOMAIN" "$HTTPS_PORT" "$CERT" "$KEY" "$MAP_NAME"
```

### Обновление

Повторно укажите **те же пять своих значений**.

```sh
DOMAIN='game.example.com'
HTTPS_PORT='8443'
CERT='/etc/ssl/example-game/fullchain.pem'
KEY='/etc/ssl/example-game/privkey.pem'
MAP_NAME='tls_routes'

curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/stream-default-site.sh -o /tmp/rust-signal-stream.sh
sudo sh /tmp/rust-signal-stream.sh update "$DOMAIN" "$HTTPS_PORT" "$CERT" "$KEY" "$MAP_NAME"
```

> [!TIP]
> Если первая установка остановилась **после подготовки файлов, но до публикации сайта**, используйте `resume` вместо `update` с теми же параметрами.

Этот скрипт **не выпускает сертификаты и не меняет существующую SNI-маршрутизацию**.

---

<a id="leaderboard"></a>

## Онлайн-рейтинг и хранение данных

В способах **1, 2 и 4**:

- API слушает только `127.0.0.1:32741` и доступен через Nginx по пути `/api/`.
- SQLite хранится **за пределами веб-каталога**.
- Для Linux каталог рейтинга: `/var/lib/rust-signal/leaderboard/`; для FreeBSD: `/var/db/rust-signal/leaderboard/`.

> [!TIP]
> **Нужны команды под конкретную ОС?**
>
> Перейдите в **[INSTALL.md](./INSTALL.md)** — там команды для Ubuntu, Debian, CentOS Stream и FreeBSD, включая обновление.
