# РЖАВЫЙ СИГНАЛ / RUST SIGNAL

Браузерная игра для VPS: главная страница — `/`, игра — `/play/`.

## Выберите один способ установки

| Ситуация на сервере | Способ | Онлайн-рейтинг |
| --- | --- | --- |
| Чистый VPS или Nginx, где домен игры ещё не занят | **1. Обычная установка** | Да |
| На нужном домене уже работает отдельный Nginx-сайт, который нужно заменить игрой | **2. Замена сайта** | Да |
| Есть готовый веб-каталог, а настройки Nginx/VPN/HTTPS менять нельзя | **3. Установка только файлов** | Нет, требуется отдельное подключение API |
| Публичный TCP/443 принимает Nginx `stream`, а SNI-маршрут `default` ведёт на внутренний HTTPS Nginx | **4. Nginx stream/SNI** | Да |

**Это альтернативные варианты. Выполните только один.** Команды запускаются в терминале **самого VPS** с правами `sudo` или `root`.

Во всех примерах `game.example.com` — условный домен, **замените его на свой**. URL `github.com/serbo26-lab/RUST-SIGNAL` менять не нужно.

## Способ 1. Новый сайт на обычном Nginx

Для чистого VPS или для сервера, где выбранный домен ещё не используется другим Nginx-сайтом. Установщик при необходимости добавляет зависимости, собирает игру, настраивает Nginx и онлайн-рейтинг.

**Что заменить:** только `game.example.com` на домен, DNS которого указывает на VPS.

**Установка:**

```sh
DOMAIN='game.example.com'
curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/vps.sh -o /tmp/rust-signal-vps.sh
sudo sh /tmp/rust-signal-vps.sh install "$DOMAIN"
```

Если нужен **HTTP только по IP**, вместо установки с доменом выполните:

```sh
curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/vps.sh -o /tmp/rust-signal-vps.sh
sudo sh /tmp/rust-signal-vps.sh install
```

**Обновление** (и для домена, и для IP):

```sh
curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/vps.sh -o /tmp/rust-signal-vps.sh
sudo sh /tmp/rust-signal-vps.sh update
```

После установки сайт работает по **HTTP**. Этот скрипт не выпускает сертификат и не включает HTTPS автоматически.

## Способ 2. Заменить существующий сайт на домене

Для случая, когда домен уже обслуживается **отдельным** Nginx-виртуальным хостом, а старый сайт больше не нужен. Установщик делает резервную копию конфигураций, сохраняет существующие порты и настройки TLS, затем устанавливает игру и онлайн-рейтинг.

**Что заменить:** `game.example.com` на домен сайта, который будет заменён.

**Установка:**

```sh
DOMAIN='game.example.com'
curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/replace-domain.sh -o /tmp/rust-signal-replace.sh
sudo sh /tmp/rust-signal-replace.sh "$DOMAIN"
```

**Обновление** — используйте `vps.sh update`, **не** запускайте повторно `replace-domain.sh`:

```sh
curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/vps.sh -o /tmp/rust-signal-vps.sh
sudo sh /tmp/rust-signal-vps.sh update
```

**Ограничение:** не подходит для общего `default_server`, смешанных конфигураций нескольких доменов или нестандартных VPN-маршрутов. Если у прежнего сайта был отдельный `location /.well-known/acme-challenge/` для продления сертификата, этот маршрут нужно восстановить в новом Nginx-конфиге: установщик его пока не переносит.

## Способ 3. Только файлы сайта, без изменений Nginx/VPN

Для сервера с уже настроенным веб-сайтом и маршрутизацией. Скрипт **не изменяет Nginx, сертификаты и порты**: заменяет только файлы в выбранном веб-каталоге.

Каталог должен **уже существовать** и содержать `index.html`. В нём не должно быть посторонних файлов, кроме `.well-known`.

**Что заменить:**
- `game.example.com` — домен сайта.
- `/var/www/example-game` — полный путь к **существующему** веб-каталогу сайта (значение `root` из его настройки веб-сервера).

**Установка:**

```sh
DOMAIN='game.example.com'
WEBROOT='/var/www/example-game'
curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/selfmask-webroot.sh -o /tmp/rust-signal-webroot.sh
sudo sh /tmp/rust-signal-webroot.sh install "$DOMAIN" "$WEBROOT"
```

**Обновление** (укажите те же домен и каталог):

```sh
DOMAIN='game.example.com'
WEBROOT='/var/www/example-game'
curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/selfmask-webroot.sh -o /tmp/rust-signal-webroot.sh
sudo sh /tmp/rust-signal-webroot.sh update "$DOMAIN" "$WEBROOT"
```

**Онлайн-рейтинг:** этот способ не устанавливает API. Для общего рейтинга потребуется отдельно подключить `/api/` к серверной части.

## Способ 4. Существующий Nginx stream/SNI-шлюз

Только для сервера, где **именно Nginx stream** принимает публичный TCP/443, а `default` существующей SNI-карты уже направляет соединения на **внутренний HTTPS-порт Nginx**. Не подходит, если `default` ведёт в VPN/Reality либо TCP/443 обслуживает другая программа.

**Замените пять значений:**

| Переменная | Что указать |
| --- | --- |
| `DOMAIN` | Новый домен игры |
| `HTTPS_PORT` | Уже работающий внутренний HTTPS-порт Nginx; `8443` здесь только пример |
| `CERT` | Полный путь к существующему сертификату этого домена (`fullchain.pem`) |
| `KEY` | Полный путь к соответствующему приватному ключу (`privkey.pem`) |
| `MAP_NAME` | Имя переменной существующей `map $ssl_preread_server_name $tls_routes` — например, `tls_routes`, **без `$`** |

**Установка:**

```sh
DOMAIN='game.example.com'
HTTPS_PORT='8443'
CERT='/etc/ssl/example-game/fullchain.pem'
KEY='/etc/ssl/example-game/privkey.pem'
MAP_NAME='tls_routes'

curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/stream-default-site.sh -o /tmp/rust-signal-stream.sh
sudo sh /tmp/rust-signal-stream.sh install "$DOMAIN" "$HTTPS_PORT" "$CERT" "$KEY" "$MAP_NAME"
```

**Обновление** (повторно укажите **те же пять своих значений**):

```sh
DOMAIN='game.example.com'
HTTPS_PORT='8443'
CERT='/etc/ssl/example-game/fullchain.pem'
KEY='/etc/ssl/example-game/privkey.pem'
MAP_NAME='tls_routes'

curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/stream-default-site.sh -o /tmp/rust-signal-stream.sh
sudo sh /tmp/rust-signal-stream.sh update "$DOMAIN" "$HTTPS_PORT" "$CERT" "$KEY" "$MAP_NAME"
```

Если первая установка завершилась **после подготовки файлов, но до публикации сайта**, вместо `update` используйте `resume` с теми же пятью параметрами. Скрипт не создаёт сертификаты и не меняет существующую SNI-маршрутизацию.

## Проверка после установки

Замените домен на свой и откройте сайт в браузере:

- `http://game.example.com/` или `https://game.example.com/` — главная страница;
- `http://game.example.com/play/` или `https://game.example.com/play/` — игра.

Используйте **HTTPS, только если он настроен на сервере**. Для способов 1, 2 и 4 проверьте API тем же протоколом:

```sh
DOMAIN='game.example.com'
curl "http://$DOMAIN/api/health"
curl "http://$DOMAIN/api/leaderboard?difficulty=veteran"
```

Если сайт работает по HTTPS, замените в двух командах `http://` на `https://`.

## Где хранится рейтинг

В способах 1, 2 и 4 API слушает `127.0.0.1:32741` и доступен через Nginx по `/api/`. База SQLite находится в `/var/lib/rust-signal/leaderboard/`, вне веб-каталога. **У каждого VPS отдельная база рейтинга**.
