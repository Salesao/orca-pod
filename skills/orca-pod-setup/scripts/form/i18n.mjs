// Texts of the orca-pod setup form in English and Russian, plus the language rules.
// One ES module for both sides: the browser loads it as /i18n.mjs (form.js imports it) and Node imports it
// (pipeline-form.mjs uses it for the localized validateServer messages and the prefill warning).
//
// Conventions
//  - MESSAGES.en and MESSAGES.ru have exactly the same keys and the same {placeholders} per key
//    (scripts/i18n.test.mjs checks it). `ru` is the original Russian text, `en` its translation.
//  - {name} placeholders are filled by t(lang, key, { name: value }); an unknown key returns the key itself.
//  - Keys starting with "plural." hold all plural forms separated by "|": en = one|other, ru = one|few|many.
//    Use tn(lang, key, n); {n} is the number.
//  - index.html text: data-i18n="key" sets the element's text; data-i18n-attr="attribute:key;attribute:key"
//    sets attributes (aria-label, title, ...). form.js applies both on start and on every language switch.
//  - Data is not UI copy and is not translated: model and agent names, catalog source lines, YAML keys.
//  - Key groups: page/app/language/profiles/profile/fullAccess/... — static screens; role./review. — role cards;
//    note. — notes under a role; v. — client validation; srv. — validateServer; agent. — subagent descriptions.

export const LANGUAGES = ['en', 'ru'];

export const MESSAGES = {
  en: {
    // ── page, header, toggle ──
    'page.title': 'Orca pipeline — setup',
    'skip.roles': 'Skip to roles',
    'lang.toggle.label': 'Interface language',
    'lang.name.en': 'English',
    'lang.name.ru': 'Русский',
    'app.title': 'Pipeline role setup',
    'app.lead': 'The pipeline splits a task between four roles in separate Orca terminals: Planner writes the plan, Implementer carries it out, Reviewer and Chief Reviewer check the result independently. Here you pick an agent and a model for each role by strength and price, plus the subagents the role hands work to in parallel.',
    'app.meta': 'Settings will be saved to {path} — the agent writes the file after validation.',
    'errors.title': 'The form was not accepted — fix the fields',

    // ── language of the roles ──
    'language.title': 'Language',
    'language.label': 'Roles language',
    'language.help': 'One language per project, for all profiles: the roles talk to you in it in their terminals. “Auto” follows the language of your message, or English when there is no text. Other tags (for example pt-BR) are set by editing the YAML and are kept by the form.',
    'language.option.auto': 'Auto — the language of the user’s message',

    // ── profiles ──
    'profiles.title': 'Profiles',
    'profiles.add': 'Add profile',
    'profiles.lead': 'A profile is its own set of agents, models and limits, for example “fast” and “high quality”. A new profile is created as a copy of the current one. If there are several profiles, the Coordinator asks which one to use before launching.',
    'profiles.tabsLabel': 'Profiles',
    'sources.summary': 'Where the models come from',
    'profile.name.label': 'Name',
    'profile.name.key': 'profiles.<name>',
    'profile.name.help': 'Letters, digits, “.”, “_” or “-”, no spaces, up to 64 characters.',
    'profile.provider.label': 'Default agent',
    'profile.provider.help': 'Roles set to “default” run in this agent.',
    'profile.max.label': 'Concurrent subagents',
    'profile.max.help': 'How many subagents one role runs at the same time: from 1 to {max}, {defaultValue} by default. This is not a counter: more can run in total during a run.',
    'fullAccess.label': 'Full access',
    'fullAccess.help': 'Yolo: roles in Codex and Claude Code start without confirmations and without a sandbox — the agent runs any command and changes any file on the machine without asking. Pi and OMP are unaffected.',
    'fullAccess.on': 'yes — Codex and Claude Code run without confirmations or a sandbox',
    'fullAccess.off': 'no — agents ask for confirmation as usual',
    'profile.default.label': 'Default profile',
    'profile.default.yes': 'yes — the Coordinator offers it first',
    'profile.default.no': 'no — turn on to make it the default profile',
    'profile.delete': 'Delete profile',
    'profile.delete.hint': 'The only profile cannot be deleted.',
    'profile.delete.confirm': 'Delete {profile}? Its settings will not be saved to the file.',
    'profile.untitled': 'untitled',
    'profile.label.unnamed': 'Profile #{n}',
    'profile.label.named': 'Profile “{name}”',
    'profile.label.duplicate': 'Profile #{n} “{name}”',
    'profile.tab.default': 'default',
    'profile.tab.error': 'errors',
    'common.number': '#{n}',
    'common.quoted': '“{value}”',
    'loading': 'Loading model catalogs…',

    // ── roles ──
    'role.planner.desc': 'Writes the specification and the plan: TODOs with dependsOn/writeScope, waves of independent tasks, stages. Parallel scouts per area; Oracle — at most 1 per plan version.',
    'role.implementer.desc': 'Integrator: the independent TODOs of a wave go to parallel workers (no more than the profile limit), then integration, checks and one review request for the whole stage.',
    'role.reviewer.desc': 'Batch review of a stage by parallel reviewer lanes (no more than the profile limit) and lens-checker; only BLOCKER/MAJOR findings block; repeat rounds check the findings registry and the delta; at most 3 attempts.',
    'role.reviewer.offDesc': 'Independently accepts every stage through batch review. Without Reviewer, Chief Reviewer accepts the stages, and without both, Implementer checks itself.',
    'role.chief_reviewer.desc': 'Chief review of all the code and of the Reviewer report history: lanes per area and one evidence-auditor per attempt; at most 2 attempts; FINAL_APPROVED. The model is usually stronger than Reviewer’s.',
    'role.chief_reviewer.offDesc': 'The chief final review of all the code on a strong model. Without it, Reviewer gives the final verdict.',
    'role.off.badge': 'not added',
    'role.add': 'Add {name}',
    'role.remove': 'Remove role',
    'review.title.full': 'full review',
    'review.title.single': 'single reviewer',
    'review.title.self': 'self-check',
    'review.text.full': 'Reviewer accepts the stages, Chief Reviewer gives the final verdict.',
    'review.text.reviewer': 'Reviewer accepts the stages and gives the final verdict itself.',
    'review.text.chief': 'Chief Reviewer accepts the stages and gives the final verdict itself.',
    'review.text.self': 'There are no reviewers: Implementer checks itself through the verifier subagent — pi-lens (in Pi), static analysis (analyze, lint, typecheck) and a check against the criteria.',
    'review.heading': 'Review mode: {title}.',
    'review.selfHint': 'Add the verifier subagent to Implementer — otherwise Implementer checks itself inline, in its own context.',

    // ── role fields and subagents ──
    'field.agent': 'Agent',
    'field.model': 'Model',
    'field.thinking': 'Thinking',
    'field.subagent': 'Subagent',
    'provider.default': 'default — {agent}',
    'provider.badgeDefault': '{agent} · default',
    'provider.noCatalog': '{agent} (no catalog)',
    'plural.models': '{n} model|{n} models',
    'model.pick': '— select a model —',
    'model.none': 'no models in the {agent} catalog',
    'think.first': '— model first —',
    'think.helpNone': 'Levels depend on the selected model.',
    'think.helpLevels': 'Supported: {levels}',
    'subagents.title': 'Subagents',
    'subagents.on': 'enabled',
    'subagents.off': 'disabled',
    'subagents.add': 'Add subagent',
    'subagents.allAdded': 'All available subagents of this role are already added.',
    'subagents.empty': 'There are no subagents — add at least one or turn off the “Subagents” switch.',
    'subagent.remove': 'Remove subagent',
    'subagent.removeLabel': 'Remove subagent {who}',
    'subagent.pick': '— select —',
    'subagent.notInRole': '{name} (not from the role’s list)',
    'inherit.model': 'inherit (= {model})',
    'inherit.noModel': 'inherit (role model not selected)',
    'inherit.thinking': 'inherit (= {level})',
    'inherit.thinkingBad': 'inherit (= {level}) — not supported',

    // ── notes under a role (the current config does not fit the catalog) ──
    'note.modelMissing': 'Model “{model}” from the current config was not found in the {agent} catalog — select it again.',
    'note.thinkingReset': 'thinking “{thinking}” is not supported by model {model} — “{next}” selected.',
    'note.subagentDuplicate': 'Subagent “{name}” was listed twice — one is kept.',
    'note.subagentModelMissing': 'The model of subagent “{name}” (“{model}”) was not found — inherit selected.',
    'note.subagentAlias': 'Subagent “{name}” in {agent} needs an alias model, not “{model}” — inherit selected.',
    'note.modelUnavailable': 'Model “{model}” is not available in agent {agent} — select a model again.',

    // ── client validation (mirrors srv.*) ──
    'v.language': 'language — “auto” or a language tag such as en, ru, pt-BR (found: “{value}”).',
    'v.profile.nameRequired': 'enter a profile name.',
    'v.profile.nameFormat': 'the name — letters, digits, “.”, “_” or “-”, no spaces, up to 64 characters.',
    'v.profile.nameTaken': 'the name is already used by profile #{n}.',
    'v.profile.limit': 'concurrent subagents — an integer from 1 to {max}.',
    'v.role.modelPick': '{role}: select a {agent} model.',
    'v.role.modelUnavailable': '{role}: the model is not available in agent {agent}.',
    'v.role.thinking': '{role}: thinking “{thinking}” is not supported by the model.',
    'v.role.noSubagents': '{role}: subagents are enabled but none are added — add one or turn them off.',
    'v.sub.label': '{role}, subagent {who}',
    'v.sub.pick': '{label}: select a subagent.',
    'v.sub.twice': '{label}: added twice.',
    'v.sub.lensPi': '{label}: lens-checker exists only in Pi.',
    'v.sub.modelUnavailable': '{label}: the model is not available in agent {agent}.',
    'v.sub.aliasOnly': '{label}: the subagent needs an alias model or inherit.',
    'v.sub.thinking': '{label}: thinking is not available for the model.',

    // ── submit, cancel, result screens, load errors ──
    'bar.status': 'Generate YAML → the agent validates and saves the config',
    'bar.cancel': 'Cancel',
    'bar.submit': 'Generate YAML',
    'status.generating': 'Generating YAML…',
    'status.cancelling': 'Cancelling…',
    'plural.status.errors': '{n} error — see the list at the top of the form|{n} errors — see the list at the top of the form',
    'confirm.cancel': 'Cancel the setup? The configuration will not change.',
    'error.generate': 'Generation failed: {message}',
    'error.cancel': 'Could not cancel: {message}',
    'error.server': 'the server replied {status}',
    'error.formClosed': 'The form is already finished.',
    'error.load': 'Could not load the form: {message}. Restart the setup from the agent.',
    'form.noModels': 'No available models were found in any agent. Check the installation and authentication.',
    'prefill.parseError': 'The current orca-pod.yaml could not be parsed ({message}) — the form is opened from scratch, and Generate YAML will replace the file.',
    'done.title': 'Settings handed to the agent',
    'done.lead': 'The agent will validate the YAML and save it to the file. You can close this tab.',
    'done.copy': 'Copy',
    'done.yamlLabel': 'Generated YAML',
    'copy.copied': 'Copied',
    'copy.status.copied': 'YAML copied to the clipboard',
    'copy.selected': 'Selected — press ⌘C',
    'copy.status.selected': 'The clipboard is unavailable, the YAML is selected',
    'cancel.title': 'Setup cancelled',
    'cancel.lead': 'The configuration is unchanged. You can close this tab.',

    // ── server validation (validateServer): lowercase labels, joined with "; " in the response ──
    'srv.notObject': 'A settings object is expected',
    'srv.noProfiles': 'At least one profile is required',
    'srv.language': 'language: “auto” or a language tag such as en, ru, pt-BR is required',
    'srv.profile.numbered': 'profile #{n}',
    'srv.profile.named': 'profile “{name}”',
    'srv.profile.prefix': '#{n}',
    'srv.profile.notObject': '{label}: an object is expected',
    'srv.profile.nameRequired': '{label}: enter a name',
    'srv.profile.nameFormat': '{label}: the name — letters, digits, “.”, “_” or “-”, no spaces, up to 64 characters',
    'srv.profile.nameTaken': '{label}: the name is already used by another profile',
    'srv.profile.limit': '{label}: concurrent subagents — an integer from 1 to {max}',
    'srv.profile.fullAccess': '{label}: full access — yes or no (boolean)',
    'srv.profile.provider': '{label}: default_provider — unknown agent {agent}',
    'srv.activeProfile': 'active_profile: profile “{name}” was not found among the profiles',
    'srv.role.required': '{role}: the required role is not filled in',
    'srv.role.unknownAgent': '{role}: unknown agent {agent}',
    'srv.role.unknownModel': '{role}: unknown model {model}',
    'srv.role.modelUnavailable': '{role}: model {model} is not available in agent {agent}',
    'srv.role.thinking': '{role}: thinking {thinking} is not supported by model {model}',
    'srv.role.useSubagents': '{role}: use_subagents must be boolean',
    'srv.role.noSubagents': '{role}: subagents are enabled but none are added',
    'srv.sub.badName': '{role}: invalid subagent name',
    'srv.sub.duplicate': '{role}: subagent {name} is added twice',
    'srv.sub.lensPi': '{role}: lens-checker exists only in Pi (pi-lens)',
    'srv.sub.unknownModel': '{role}/{name}: unknown model {model}',
    'srv.sub.modelUnavailable': '{role}/{name}: the subagent model is not available in the role’s agent ({agent})',
    'srv.sub.aliasOnly': '{role}/{name}: the subagent needs an alias model or inherit, not a specific version',
    'srv.sub.thinking': '{role}/{name}: thinking {thinking} is not available for the subagent model',

    // ── subagent descriptions shown under the subagent field ──
    'agent.scout': 'Code recon: finds files, relationships and risks, returns compressed context. Example: “find where the subscription logic lives and what a plan change would affect”. Does not write code.',
    'agent.researcher': 'Research of external sources: documentation, specifications, recent changes — a digest with links. Example: “check the current axios API for cancelling a request”. Runs when needed.',
    'agent.worker': 'TODO executor: edits files only inside its exclusive zone (writeScope). The integrator starts one worker per independent TODO of a wave in parallel (no more than the profile limit “Concurrent subagents”) and per group of fixes after review. Example: “implement DEV-02 in lib/features/sync/**”.',
    'agent.reviewer': 'Read-only review lane: checks its slice of the batch (a TODO, a seam, the delta of fixes or earlier findings) against the criteria and returns classified findings. Reviewer runs lanes in parallel (no more than the profile limit), Chief — per code area. Does not make decisions.',
    'agent.lens-checker': 'Pi only (pi-lens): LSP diagnostics of type errors in the changed files, a compact report — the reviewers’ type-check lane. Absent in Claude Code and Codex — the step is skipped.',
    'agent.verifier': 'Implementer self-check without reviewers: read-only, runs pi-lens (in Pi) and the static checks from the plan (analyze, lint, typecheck), checks the criteria and returns S<n> findings. Does not make decisions — Implementer sets SELF_VERIFIED.',
    'agent.oracle': 'Read-only adviser to Planner for a contested architectural choice or the risk of breaking accepted decisions. Example: “compare two options for storing the token given the requirements”. At most 1 call per plan version; simple tasks go without it. Does not write code and does not approve the plan.',
    'agent.evidence-auditor': 'Read-only evidence auditor of Chief Reviewer: maps the key acceptance criteria to Implementer’s claims and the actual materials. Example: “what confirms the request-cancellation requirement is met?”. One call per chief-review attempt, in parallel with the lanes; does not run tests and does not issue FINAL_APPROVED.',
  },

  ru: {
    // ── page, header, toggle ──
    'page.title': 'Orca pipeline — настройка',
    'skip.roles': 'Перейти к ролям',
    'lang.toggle.label': 'Язык интерфейса',
    'lang.name.en': 'English',
    'lang.name.ru': 'Русский',
    'app.title': 'Настройка ролей pipeline',
    'app.lead': 'Pipeline делит задачу между четырьмя ролями в отдельных терминалах Orca: Planner составляет план, Implementer реализует его, Reviewer и Chief Reviewer независимо проверяют результат. Здесь каждой роли подбирается агент и модель по силе и цене, а также субагенты, которым роль раздаёт работу параллельно.',
    'app.meta': 'Настройки сохранятся в {path} — агент запишет файл после проверки.',
    'errors.title': 'Форма не принята — исправь поля',

    // ── language of the roles ──
    'language.title': 'Язык',
    'language.label': 'Язык ролей',
    'language.help': 'Один язык на проект, для всех профилей: на нём роли общаются с вами в терминалах. «Авто» — язык вашего сообщения, а без текста — английский. Другие теги (например pt-BR) задаются правкой YAML и в форме сохраняются.',
    'language.option.auto': 'Авто — язык сообщения пользователя',

    // ── profiles ──
    'profiles.title': 'Профили',
    'profiles.add': 'Добавить профиль',
    'profiles.lead': 'Профиль — свой набор агентов, моделей и лимитов, например «быстрый» и «качественный». Новый профиль создаётся копией текущего. Если профилей несколько, Coordinator перед запуском спросит, какой использовать.',
    'profiles.tabsLabel': 'Профили',
    'sources.summary': 'Откуда взяты модели',
    'profile.name.label': 'Название',
    'profile.name.key': 'profiles.<name>',
    'profile.name.help': 'Буквы, цифры, «.», «_» или «-», без пробелов, до 64 символов.',
    'profile.provider.label': 'Агент по умолчанию',
    'profile.provider.help': 'Роли с «по умолчанию» работают в этом агенте.',
    'profile.max.label': 'Субагентов одновременно',
    'profile.max.help': 'Сколько субагентов одна роль запускает одновременно: от 1 до {max}, по умолчанию {defaultValue}. Это не счётчик: всего за прогон их может быть больше.',
    'fullAccess.label': 'Полные права',
    'fullAccess.help': 'Yolo: роли в Codex и Claude Code запускаются без подтверждений и без sandbox — агент выполняет любые команды и меняет любые файлы на машине, не спрашивая. Pi и OMP не меняются.',
    'fullAccess.on': 'да — Codex и Claude Code работают без подтверждений и sandbox',
    'fullAccess.off': 'нет — агенты спрашивают подтверждения, как обычно',
    'profile.default.label': 'Профиль по умолчанию',
    'profile.default.yes': 'да — Coordinator предложит его первым',
    'profile.default.no': 'нет — включи, чтобы сделать профилем по умолчанию',
    'profile.delete': 'Удалить профиль',
    'profile.delete.hint': 'Единственный профиль удалить нельзя.',
    'profile.delete.confirm': 'Удалить: {profile}? Его настройки не попадут в файл.',
    'profile.untitled': 'без названия',
    'profile.label.unnamed': 'Профиль №{n}',
    'profile.label.named': 'Профиль «{name}»',
    'profile.label.duplicate': 'Профиль №{n} «{name}»',
    'profile.tab.default': 'по умолчанию',
    'profile.tab.error': 'ошибки',
    'common.number': '№{n}',
    'common.quoted': '«{value}»',
    'loading': 'Загружаю каталоги моделей…',

    // ── roles ──
    'role.planner.desc': 'Составляет спецификацию и план: TODO с dependsOn/writeScope, волны независимых задач, этапы. Параллельные scout по областям; Oracle — максимум 1 на версию плана.',
    'role.implementer.desc': 'Интегратор: независимые TODO волны — параллельными worker-ами (не больше лимита профиля), затем интеграция, проверки и один запрос ревью на весь этап.',
    'role.reviewer.desc': 'Пакетное ревью этапа параллельными reviewer-lanes (не больше лимита профиля) и lens-checker; блокируют только BLOCKER/MAJOR; повторные раунды проверяют реестр замечаний и delta; не больше 3 попыток.',
    'role.reviewer.offDesc': 'Независимо принимает каждый этап пакетным ревью. Без Reviewer этапы принимает Chief Reviewer, а без обоих Implementer проверяет себя сам.',
    'role.chief_reviewer.desc': 'Главное ревью всего кода и истории отчётов Reviewer: lanes по областям и один evidence-auditor за попытку; не больше 2 попыток; FINAL_APPROVED. Модель обычно сильнее Reviewer.',
    'role.chief_reviewer.offDesc': 'Главное финальное ревью всего кода на сильной модели. Без него финальный вердикт выносит Reviewer.',
    'role.off.badge': 'не добавлена',
    'role.add': 'Добавить {name}',
    'role.remove': 'Убрать роль',
    'review.title.full': 'полное ревью',
    'review.title.single': 'один ревьюер',
    'review.title.self': 'самопроверка',
    'review.text.full': 'Reviewer принимает этапы, Chief Reviewer выносит финальный вердикт.',
    'review.text.reviewer': 'Reviewer принимает этапы и сам выносит финальный вердикт.',
    'review.text.chief': 'Chief Reviewer принимает этапы и сам выносит финальный вердикт.',
    'review.text.self': 'Ревьюеров нет: Implementer проверяет себя через субагента verifier — pi-lens (в Pi), статический анализ (analyze, lint, typecheck) и сверка критериев.',
    'review.heading': 'Режим проверки: {title}.',
    'review.selfHint': 'Добавь Implementer субагента verifier — иначе Implementer проверяет себя inline, в своём контексте.',

    // ── role fields and subagents ──
    'field.agent': 'Агент',
    'field.model': 'Модель',
    'field.thinking': 'Thinking',
    'field.subagent': 'Субагент',
    'provider.default': 'по умолчанию — {agent}',
    'provider.badgeDefault': '{agent} · по умолчанию',
    'provider.noCatalog': '{agent} (нет каталога)',
    'plural.models': '{n} модель|{n} модели|{n} моделей',
    'model.pick': '— выбрать модель —',
    'model.none': 'нет моделей в каталоге {agent}',
    'think.first': '— сначала модель —',
    'think.helpNone': 'Уровни зависят от выбранной модели.',
    'think.helpLevels': 'Поддерживает: {levels}',
    'subagents.title': 'Субагенты',
    'subagents.on': 'включены',
    'subagents.off': 'выключены',
    'subagents.add': 'Добавить субагента',
    'subagents.allAdded': 'Все доступные субагенты этой роли уже добавлены.',
    'subagents.empty': 'Субагентов нет — добавь хотя бы одного или выключи переключатель «Субагенты».',
    'subagent.remove': 'Удалить субагента',
    'subagent.removeLabel': 'Удалить субагента {who}',
    'subagent.pick': '— выбрать —',
    'subagent.notInRole': '{name} (не из списка роли)',
    'inherit.model': 'inherit (= {model})',
    'inherit.noModel': 'inherit (модель роли не выбрана)',
    'inherit.thinking': 'inherit (= {level})',
    'inherit.thinkingBad': 'inherit (= {level}) — не поддерживается',

    // ── notes under a role (the current config does not fit the catalog) ──
    'note.modelMissing': 'Модель «{model}» из текущего конфига не найдена в каталоге {agent} — выбери заново.',
    'note.thinkingReset': 'thinking «{thinking}» не поддерживается моделью {model} — выбрано «{next}».',
    'note.subagentDuplicate': 'Субагент «{name}» был указан дважды — оставлен один.',
    'note.subagentModelMissing': 'Модель субагента «{name}» («{model}») не найдена — выбрано inherit.',
    'note.subagentAlias': 'Субагенту «{name}» в {agent} нужна alias-модель, а не «{model}» — выбрано inherit.',
    'note.modelUnavailable': 'Модель «{model}» недоступна в агенте {agent} — выбери модель заново.',

    // ── client validation (mirrors srv.*) ──
    'v.language': 'язык — «auto» или тег языка вроде en, ru, pt-BR (прочитано: «{value}»).',
    'v.profile.nameRequired': 'укажи название профиля.',
    'v.profile.nameFormat': 'название — буквы, цифры, «.», «_» или «-», без пробелов, до 64 символов.',
    'v.profile.nameTaken': 'название уже занято профилем №{n}.',
    'v.profile.limit': 'субагентов одновременно — целое число от 1 до {max}.',
    'v.role.modelPick': '{role}: выбери модель {agent}.',
    'v.role.modelUnavailable': '{role}: модель недоступна в агенте {agent}.',
    'v.role.thinking': '{role}: thinking «{thinking}» не поддерживается моделью.',
    'v.role.noSubagents': '{role}: субагенты включены, но не добавлены — добавь или выключи.',
    'v.sub.label': '{role}, субагент {who}',
    'v.sub.pick': '{label}: выбери субагента.',
    'v.sub.twice': '{label}: добавлен дважды.',
    'v.sub.lensPi': '{label}: lens-checker есть только в Pi.',
    'v.sub.modelUnavailable': '{label}: модель недоступна в агенте {agent}.',
    'v.sub.aliasOnly': '{label}: субагенту нужна alias-модель или inherit.',
    'v.sub.thinking': '{label}: thinking недоступен для модели.',

    // ── submit, cancel, result screens, load errors ──
    'bar.status': 'Сгенерировать YAML → агент проверит и сохранит конфиг',
    'bar.cancel': 'Отмена',
    'bar.submit': 'Сгенерировать YAML',
    'status.generating': 'Генерирую YAML…',
    'status.cancelling': 'Отменяю…',
    'plural.status.errors': '{n} ошибка — см. список вверху формы|{n} ошибки — см. список вверху формы|{n} ошибок — см. список вверху формы',
    'confirm.cancel': 'Отменить настройку? Конфигурация не изменится.',
    'error.generate': 'Ошибка генерации: {message}',
    'error.cancel': 'Не удалось отменить: {message}',
    'error.server': 'сервер ответил {status}',
    'error.formClosed': 'Форма уже завершена',
    'error.load': 'Не удалось загрузить форму: {message}. Перезапусти настройку из агента.',
    'form.noModels': 'Ни в одном агенте не найдено доступных моделей. Проверь установку и авторизацию.',
    'prefill.parseError': 'Текущий orca-pod.yaml не разобран ({message}) — форма открыта с нуля, и «Сгенерировать YAML» заменит файл.',
    'done.title': 'Настройки переданы агенту',
    'done.lead': 'Агент проверит YAML и сохранит его в файл. Эту вкладку можно закрыть.',
    'done.copy': 'Копировать',
    'done.yamlLabel': 'Сгенерированный YAML',
    'copy.copied': 'Скопировано',
    'copy.status.copied': 'YAML скопирован в буфер обмена',
    'copy.selected': 'Выделено — нажми ⌘C',
    'copy.status.selected': 'Буфер обмена недоступен, YAML выделен',
    'cancel.title': 'Настройка отменена',
    'cancel.lead': 'Конфигурация не изменена. Эту вкладку можно закрыть.',

    // ── server validation (validateServer): lowercase labels, joined with "; " in the response ──
    'srv.notObject': 'Ожидается объект настроек',
    'srv.noProfiles': 'Нужен хотя бы один профиль',
    'srv.language': 'language: нужен «auto» или тег языка вроде en, ru, pt-BR',
    'srv.profile.numbered': 'профиль №{n}',
    'srv.profile.named': 'профиль «{name}»',
    'srv.profile.prefix': '№{n}',
    'srv.profile.notObject': '{label}: ожидается объект',
    'srv.profile.nameRequired': '{label}: укажи имя',
    'srv.profile.nameFormat': '{label}: имя — буквы, цифры, «.», «_» или «-» без пробелов, до 64 символов',
    'srv.profile.nameTaken': '{label}: имя уже занято другим профилем',
    'srv.profile.limit': '{label}: субагентов одновременно — целое от 1 до {max}',
    'srv.profile.fullAccess': '{label}: полные права — да или нет (boolean)',
    'srv.profile.provider': '{label}: default_provider — неизвестный агент {agent}',
    'srv.activeProfile': 'active_profile: профиль «{name}» не найден среди профилей',
    'srv.role.required': '{role}: обязательная роль не заполнена',
    'srv.role.unknownAgent': '{role}: неизвестный агент {agent}',
    'srv.role.unknownModel': '{role}: неизвестная модель {model}',
    'srv.role.modelUnavailable': '{role}: модель {model} недоступна в агенте {agent}',
    'srv.role.thinking': '{role}: thinking {thinking} не поддерживается моделью {model}',
    'srv.role.useSubagents': '{role}: use_subagents должен быть boolean',
    'srv.role.noSubagents': '{role}: субагенты включены, но не добавлены',
    'srv.sub.badName': '{role}: недопустимое имя субагента',
    'srv.sub.duplicate': '{role}: субагент {name} добавлен дважды',
    'srv.sub.lensPi': '{role}: lens-checker есть только в Pi (pi-lens)',
    'srv.sub.unknownModel': '{role}/{name}: неизвестная модель {model}',
    'srv.sub.modelUnavailable': '{role}/{name}: модель субагента недоступна в агенте роли ({agent})',
    'srv.sub.aliasOnly': '{role}/{name}: субагенту нужна alias-модель или inherit, не конкретная версия',
    'srv.sub.thinking': '{role}/{name}: thinking {thinking} недоступен для модели субагента',

    // ── subagent descriptions shown under the subagent field ──
    'agent.scout': 'Разведка кода: находит файлы, связи и риски, возвращает сжатый контекст. Пример: «найди, где живёт логика подписок и что затронет смена тарифов». Код не пишет.',
    'agent.researcher': 'Исследование внешних источников: документация, спецификации, свежие изменения — выжимка со ссылками. Пример: «проверь актуальный API axios для отмены запроса». Запускается по необходимости.',
    'agent.worker': 'Исполнитель TODO: правит файлы только в своей исключительной зоне (writeScope). Интегратор запускает по worker-у на каждый независимый TODO волны параллельно (не больше лимита профиля «Субагентов одновременно») и группы исправлений после ревью. Пример: «реализуй DEV-02 в lib/features/sync/**».',
    'agent.reviewer': 'Read-only review-lane: проверяет свой срез пакета (TODO, стык, delta исправлений или прежние замечания) по критериям и возвращает классифицированные findings. Reviewer запускает lanes параллельно (не больше лимита профиля), Chief — по областям кода. Решений не выносит.',
    'agent.lens-checker': 'Только Pi (pi-lens): LSP-диагностики type errors по изменённым файлам, компактный отчёт — type-check lane ревьюеров. В Claude Code и Codex отсутствует — шаг опускается.',
    'agent.verifier': 'Самопроверка Implementer без ревьюеров: read-only, гоняет pi-lens (в Pi) и статические проверки из плана (analyze, lint, typecheck), сверяет критерии и возвращает замечания S<n>. Решения не выносит — SELF_VERIFIED ставит Implementer.',
    'agent.oracle': 'Read-only советник Planner для спорного архитектурного выбора или риска нарушить принятые решения. Пример: «сравни два варианта хранения токена с учётом требований». Максимум 1 вызов на версию плана; простые задачи проходят без него. Не пишет код и не одобряет план.',
    'agent.evidence-auditor': 'Read-only аудитор доказательств Chief Reviewer: сопоставляет ключевые acceptance criteria с утверждениями Implementer и фактическими материалами. Пример: «что подтверждает выполнение требования об отмене запроса?». Один вызов за попытку главного ревью, параллельно с lanes; тесты не запускает и FINAL_APPROVED не выдаёт.',
  },
};

const FALLBACK = 'en';
const dictionaryOf = (lang) => (typeof lang === 'string' && Object.hasOwn(MESSAGES, lang) ? lang : FALLBACK);
const rawMessage = (lang, key) => {
  const dictionary = MESSAGES[dictionaryOf(lang)];
  return Object.hasOwn(dictionary, key) ? dictionary[key] : null;
};
const fill = (message, params) => message.replace(/\{(\w+)\}/g, (placeholder, name) => (params && Object.hasOwn(params, name) ? String(params[name]) : placeholder));

export const hasMessage = (key) => typeof key === 'string' && Object.hasOwn(MESSAGES[FALLBACK], key);

/** t('ru', 'role.add', { name: 'Reviewer' }) → text with {placeholders} filled; unknown key → the key. */
export function t(lang, key, params) {
  const message = rawMessage(lang, key);
  return message === null ? key : fill(message, params);
}

// Plural form index: Russian one|few|many, everything else one|other.
function pluralIndex(lang, n) {
  if (lang !== 'ru') return n === 1 ? 0 : 1;
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 0;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 1;
  return 2;
}

/** tn('en', 'plural.models', 3) → '3 models'; the key holds the forms separated by "|" (Russian: one|few|many); {n} is the number. */
export function tn(lang, key, n, params) {
  const message = rawMessage(lang, key);
  if (message === null) return key;
  const forms = message.split('|');
  const form = forms[Math.min(pluralIndex(dictionaryOf(lang), Math.abs(n)), forms.length - 1)];
  return fill(form, { ...params, n });
}

const primarySubtag = (tag) => String(tag).trim().toLowerCase().split(/[-_]/)[0];

/**
 * UI language: an explicit config language tag wins (ru, ru-RU → 'ru', any other tag → 'en');
 * 'auto' or none → the first browser language (ru* → 'ru'), otherwise 'en'.
 */
export function pickLanguage({ configLanguage, browserLanguages } = {}) {
  const configured = typeof configLanguage === 'string' ? configLanguage.trim() : '';
  if (configured && configured !== 'auto') return primarySubtag(configured) === 'ru' ? 'ru' : 'en';
  const first = (Array.isArray(browserLanguages) ? browserLanguages : []).find((tag) => typeof tag === 'string' && tag.trim());
  return first && primarySubtag(first) === 'ru' ? 'ru' : 'en';
}
