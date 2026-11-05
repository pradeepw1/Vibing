// What the "describe it" box knows: the kinds of thing you can build (shapes),
// the parts they're made from (capabilities), and the tools for each route.
// A tool is [name, link, why, install command (optional)].
(function (root) {
  const ibm = (path) => `https://www.ibm.com/docs/en/${path}`;
  const apple = (path) => `https://developer.apple.com/documentation/${path}`;

  const routes = [
    { id: 'python', label: 'Python', langs: ['python'], decks: ['python'] },
    { id: 'swift', label: 'Swift', langs: ['swift'], decks: ['swift'] },
    { id: 'java', label: 'Java', langs: ['java'], decks: ['java'] },
    { id: 'frontend', label: 'JavaScript and TypeScript', langs: ['js', 'ts', 'html', 'css'], decks: ['frontend'] },
    { id: 'mainframe', label: 'COBOL and mainframe', langs: ['cobol', 'jcl'], decks: ['cobol', 'mainframe'] },
  ];

  const shapes = [
    {
      id: 'web', label: 'a website', picker: 'Website', strong: true,
      triggers: ['website', 'web site', 'web app', 'webapp', 'web page', 'webpage', 'landing page', 'browser', 'blog', 'portfolio', 'online store', 'online shop', 'saas', 'marketplace', 'forum', 'pwa'],
      fit: { frontend: 10, python: 6, java: 5, swift: 1, mainframe: 0 },
      start: {
        frontend: [
          ['Next.js', 'https://nextjs.org/', 'The most common way to build a full React site: pages, and a server in one project.', 'npx create-next-app@latest'],
          ['Tailwind CSS', 'https://tailwindcss.com/', 'Style things with short class names, right in your HTML.'],
          ['Vercel', 'https://vercel.com/', 'Puts your site online from a Git push, with a free tier.'],
        ],
        python: [
          ['Django', 'https://www.djangoproject.com/', 'A whole site in a box: pages, database, sign-in and an admin area.', 'pip install django'],
          ['HTMX', 'https://htmx.org/', 'Makes pages feel live with a few HTML attributes, and little JavaScript.'],
        ],
        java: [
          ['Spring Boot', 'https://spring.io/projects/spring-boot', 'The standard way to build a Java web service.'],
          ['Thymeleaf', 'https://www.thymeleaf.org/', 'Builds HTML pages on the server from templates.'],
        ],
        swift: [
          ['Vapor', 'https://vapor.codes/', 'A server framework written in Swift.'],
        ],
        mainframe: [],
      },
    },
    {
      id: 'ios', label: 'an iPhone or iPad app', picker: 'iPhone app', strong: true,
      triggers: ['iphone', 'ipad', 'ios', 'apple watch', 'watch app', 'app store', 'mobile app', 'phone app', 'testflight'],
      fit: { swift: 10, frontend: 4, java: 1, python: 1, mainframe: 0 },
      start: {
        swift: [
          ['Xcode', 'https://developer.apple.com/xcode/', "Apple's app for building, running and shipping iPhone apps."],
          ['SwiftUI', apple('swiftui'), 'Describe your screens in Swift, and they work across Apple devices.'],
        ],
        frontend: [
          ['Expo', 'https://expo.dev/', 'Build iPhone and Android apps with React and TypeScript.', 'npx create-expo-app@latest'],
        ],
        python: [], java: [], mainframe: [],
      },
    },
    {
      id: 'mac', label: 'a Mac app', picker: 'Mac app', strong: true,
      triggers: ['mac app', 'macos', 'menu bar', 'mac desktop', 'on my mac', 'for mac'],
      fit: { swift: 10, frontend: 5, python: 3, java: 3, mainframe: 0 },
      start: {
        swift: [
          ['Xcode', 'https://developer.apple.com/xcode/', "Apple's app for building and shipping Mac apps."],
          ['SwiftUI', apple('swiftui'), 'The same screens you would write for iPhone, on the Mac.'],
        ],
        frontend: [
          ['Tauri', 'https://tauri.app/', 'Wraps a web page as a small desktop app.'],
          ['Electron', 'https://www.electronjs.org/', 'The heavier, well-known way to do the same. VS Code uses it.'],
        ],
        python: [['PySide6', 'https://doc.qt.io/qtforpython-6/', 'Desktop windows in Python, using Qt.', 'pip install pyside6']],
        java: [['JavaFX', 'https://openjfx.io/', 'Desktop windows in Java.']],
        mainframe: [],
      },
    },
    {
      id: 'android', label: 'an Android app', picker: 'Android app', strong: true,
      triggers: ['android', 'play store', 'google play'],
      fit: { java: 9, frontend: 5, swift: 0, python: 1, mainframe: 0 },
      start: {
        java: [
          ['Android Studio', 'https://developer.android.com/studio', "Google's tool for building Android apps. New projects mostly use Kotlin, a close cousin of Java."],
        ],
        frontend: [
          ['Expo', 'https://expo.dev/', 'Build Android and iPhone apps with React and TypeScript.', 'npx create-expo-app@latest'],
        ],
        python: [], swift: [], mainframe: [],
      },
    },
    {
      id: 'desktop', label: 'a desktop app', picker: 'Desktop app', strong: true,
      triggers: ['desktop app', 'desktop application', 'windows app', 'windows application', 'linux app'],
      fit: { frontend: 7, java: 6, python: 6, swift: 3, mainframe: 0 },
      start: {
        frontend: [
          ['Tauri', 'https://tauri.app/', 'Wraps a web page as a small desktop app for Mac, Windows and Linux.'],
          ['Electron', 'https://www.electronjs.org/', 'The heavier, well-known way to do the same.'],
        ],
        java: [['JavaFX', 'https://openjfx.io/', 'Desktop windows that run wherever Java does.']],
        python: [['PySide6', 'https://doc.qt.io/qtforpython-6/', 'Desktop windows in Python, using Qt.', 'pip install pyside6']],
        swift: [['SwiftUI', apple('swiftui'), 'Desktop apps for Mac only.']],
        mainframe: [],
      },
    },
    {
      id: 'extension', label: 'a browser extension', picker: 'Browser extension', strong: true,
      triggers: ['browser extension', 'chrome extension', 'firefox addon', 'browser plugin', 'chrome plugin'],
      fit: { frontend: 10, swift: 1, python: 0, java: 0, mainframe: 0 },
      start: {
        frontend: [
          ['WXT', 'https://wxt.dev/', 'A friendly starter for extensions, with TypeScript.', 'npx wxt@latest init'],
          ['Chrome extension docs', 'https://developer.chrome.com/docs/extensions', 'The official guide.'],
        ],
        python: [], swift: [], java: [], mainframe: [],
      },
    },
    {
      id: 'api', label: 'a backend service', picker: 'Backend or API', strong: true,
      triggers: ['api', 'rest api', 'graphql', 'backend', 'back end', 'microservice', 'web service', 'server', 'webhook', 'endpoint'],
      fit: { java: 9, python: 9, frontend: 7, swift: 2, mainframe: 2 },
      start: {
        python: [
          ['FastAPI', 'https://fastapi.tiangolo.com/', 'A quick way to build an API, with docs made for you.', 'pip install "fastapi[standard]"'],
        ],
        java: [
          ['Spring Boot', 'https://spring.io/projects/spring-boot', 'The industry standard for Java services.'],
        ],
        frontend: [
          ['Hono', 'https://hono.dev/', 'A small, fast server framework for TypeScript.', 'npm create hono@latest'],
          ['Express', 'https://expressjs.com/', 'The long-standing Node choice, with lots of examples around.'],
        ],
        swift: [['Vapor', 'https://vapor.codes/', 'A server framework written in Swift.']],
        mainframe: [['z/OS Connect', ibm('zos-connect'), 'Puts a REST API in front of COBOL programs.']],
      },
    },
    {
      id: 'script', label: 'a script that does a job for you', picker: 'Script', strong: true,
      triggers: ['script', 'automate', 'automation', 'bot', 'scrape', 'scraper', 'scraping', 'crawl', 'crawler', 'cron', 'every morning', 'every day', 'every night', 'every hour', 'every week', 'clean up', 'rename', 'watch a folder'],
      fit: { python: 10, frontend: 6, java: 2, swift: 2, mainframe: 1 },
      start: {
        python: [
          ['uv', 'https://docs.astral.sh/uv/', 'Sets up Python and your libraries, fast.'],
        ],
        frontend: [['Node.js', 'https://nodejs.org/', 'Runs JavaScript outside the browser.']],
        swift: [['Swift scripts', 'https://www.swift.org/getting-started/', 'Good for jobs on your own Mac.']],
        java: [], mainframe: [],
      },
    },
    {
      id: 'cli', label: 'a command-line tool', picker: 'Command-line tool', strong: true,
      triggers: ['command line', 'command-line', 'cli', 'terminal tool', 'terminal app'],
      fit: { python: 9, swift: 6, java: 5, frontend: 6, mainframe: 0 },
      start: {
        python: [['Typer', 'https://typer.tiangolo.com/', 'Turns a Python function into a command, with help text.', 'pip install typer']],
        swift: [['Swift Argument Parser', 'https://github.com/apple/swift-argument-parser', "Apple's library for command-line options."]],
        java: [['Picocli', 'https://picocli.info/', 'Command-line options for Java.']],
        frontend: [['Commander', 'https://github.com/tj/commander.js', 'Command-line options for Node.', 'npm install commander']],
        mainframe: [],
      },
    },
    {
      id: 'data', label: 'a data analysis project', picker: 'Data or AI project', strong: true,
      triggers: ['data analysis', 'analyse', 'analyze', 'analysis', 'notebook', 'dataset', 'data pipeline', 'data science', 'etl', 'train a model', 'machine learning'],
      fit: { python: 10, java: 3, frontend: 2, swift: 1, mainframe: 1 },
      start: {
        python: [
          ['Jupyter', 'https://jupyter.org/', 'A notebook that mixes code, charts and notes.', 'pip install jupyterlab'],
          ['pandas', 'https://pandas.pydata.org/', 'Tables of data you can filter, group and sum.', 'pip install pandas'],
        ],
        java: [['Apache Spark', 'https://spark.apache.org/', 'Handles data too big for one machine.']],
        frontend: [], swift: [], mainframe: [],
      },
    },
    {
      id: 'game', label: 'a game', picker: 'Game', strong: true,
      triggers: ['game', 'multiplayer', 'puzzle', 'platformer', 'sprite', 'arcade'],
      fit: { frontend: 8, swift: 7, python: 5, java: 5, mainframe: 0 },
      start: {
        frontend: [
          ['Phaser', 'https://phaser.io/', 'A 2D game framework that runs in the browser.', 'npm create @phaserjs/game@latest'],
          ['Three.js', 'https://threejs.org/', '3D graphics in a web page.', 'npm install three'],
        ],
        swift: [
          ['SpriteKit', apple('spritekit'), "Apple's 2D game framework."],
          ['RealityKit', apple('realitykit'), "Apple's 3D framework."],
        ],
        python: [['Pygame', 'https://www.pygame.org/', 'A simple way to learn game programming.', 'pip install pygame']],
        java: [['libGDX', 'https://libgdx.com/', 'A Java game framework for desktop and Android.']],
        mainframe: [],
      },
    },
    {
      id: 'batch', label: 'a mainframe batch job', picker: 'Mainframe batch', strong: true,
      triggers: ['mainframe', 'cobol', 'jcl', 'batch', 'batch job', 'nightly job', 'overnight', 'z/os', 'zos', 'master file', 'payroll run', 'settlement', 'end of day'],
      fit: { mainframe: 12, java: 5, python: 3, frontend: 0, swift: 0 },
      start: {
        mainframe: [
          ['Enterprise COBOL', ibm('cobol-zos'), 'The program that does the work.'],
          ['JCL', ibm('zos'), 'Says what to run, and which datasets to use.'],
          ['GnuCOBOL', 'https://gnucobol.sourceforge.io/', 'Lets you practise COBOL on your own Mac.'],
        ],
        java: [['Spring Batch', 'https://spring.io/projects/spring-batch', 'The modern equivalent: batch jobs in Java.']],
        python: [], frontend: [], swift: [],
      },
    },
    {
      id: 'online', label: 'an online mainframe transaction', picker: 'Mainframe online', strong: true,
      triggers: ['cics', '3270', 'green screen', 'bms map', 'ims', 'online transaction', 'teller screen'],
      fit: { mainframe: 12, java: 3, python: 0, frontend: 2, swift: 0 },
      start: {
        mainframe: [
          ['CICS', ibm('cics-ts'), 'Runs online programs for thousands of users at once.'],
          ['BMS maps', ibm('cics-ts'), 'Define the 3270 screens.'],
          ['Enterprise COBOL', ibm('cobol-zos'), 'The language of the transaction programs.'],
        ],
        java: [['Spring Boot', 'https://spring.io/projects/spring-boot', 'The usual modern equivalent.']],
        frontend: [], python: [], swift: [],
      },
    },
  ];

  const caps = [
    {
      id: 'store', label: 'Saving data', plain: 'Keeps information safe, so it is still there tomorrow.',
      triggers: ['save', 'store', 'database', 'track', 'tracker', 'keep track', 'log', 'record', 'history', 'inventory', 'diary', 'journal', 'notes', 'to do', 'todo', 'list of', 'expenses', 'budget', 'crm', 'orders', 'customers', 'workouts'],
      learn: ['database', 'records'],
      tools: {
        python: [['SQLAlchemy', 'https://www.sqlalchemy.org/', 'Talk to a database with Python objects.', 'pip install sqlalchemy'], ['SQLite', 'https://docs.python.org/3/library/sqlite3.html', 'A database in one file, built into Python.']],
        swift: [['SwiftData', apple('swiftdata'), 'Saves your Swift types on the device.'], ['CloudKit', apple('cloudkit'), "Syncs through people's iCloud."]],
        java: [['Spring Data JPA', 'https://spring.io/projects/spring-data-jpa', 'Saves Java objects with very little code.'], ['PostgreSQL', 'https://www.postgresql.org/', 'The trusted open-source database.']],
        frontend: [['Supabase', 'https://supabase.com/', 'A hosted Postgres database with a simple client.', 'npm install @supabase/supabase-js'], ['Drizzle', 'https://orm.drizzle.team/', 'Type-safe database queries in TypeScript.', 'npm install drizzle-orm']],
        mainframe: [['Db2', ibm('db2-for-zos'), 'The relational database on z/OS.'], ['VSAM', ibm('zos'), 'Keyed files for fast lookups.']],
      },
    },
    {
      id: 'auth', label: 'Sign-in', plain: 'People get their own accounts, and log in.',
      triggers: ['login', 'log in', 'sign in', 'sign up', 'signup', 'account', 'accounts', 'password', 'members', 'membership', 'user profile', 'each user', 'my users'],
      learn: ['input', 'errors'],
      tools: {
        python: [['Django auth', 'https://docs.djangoproject.com/en/stable/topics/auth/', 'Sign-in comes built into Django.'], ['Authlib', 'https://docs.authlib.org/', 'Sign in with Google and others.', 'pip install authlib']],
        swift: [['Sign in with Apple', apple('authenticationservices'), 'The simplest sign-in on Apple devices.']],
        java: [['Spring Security', 'https://spring.io/projects/spring-security', 'The standard for sign-in and permissions in Java.']],
        frontend: [['Clerk', 'https://clerk.com/', 'Ready-made sign-in screens, hosted for you.'], ['Auth.js', 'https://authjs.dev/', 'Open-source sign-in you run yourself.']],
        mainframe: [['RACF', ibm('zos'), 'Controls who can use what on z/OS.']],
      },
    },
    {
      id: 'pay', label: 'Taking payments', plain: 'People pay you. Never handle card numbers yourself.', server: true,
      triggers: ['pay', 'payment', 'payments', 'subscription', 'subscribe', 'checkout', 'sell', 'selling', 'buy', 'purchase', 'billing', 'shopping cart', 'in app purchase', 'donation', 'stripe', 'ecommerce', 'e commerce', 'online store', 'online shop'],
      learn: ['errors', 'numbers'],
      tools: {
        python: [['Stripe', 'https://docs.stripe.com/', 'Takes the payment, and holds the card details for you.', 'pip install stripe']],
        swift: [['StoreKit', apple('storekit'), "Apple's in-app purchases. Required for digital goods."], ['Stripe iOS', 'https://github.com/stripe/stripe-ios', 'For real-world goods and services.']],
        java: [['Stripe Java', 'https://github.com/stripe/stripe-java', 'Takes payments from a Java service.']],
        frontend: [['Stripe', 'https://docs.stripe.com/', 'Takes the payment, and holds the card details for you.', 'npm install stripe']],
        mainframe: [['IBM MQ', ibm('ibm-mq'), 'Carries payment messages between systems, and never loses one.']],
      },
    },
    {
      id: 'charts', label: 'Charts', plain: 'Turns numbers into pictures.',
      triggers: ['chart', 'charts', 'graph', 'graphs', 'dashboard', 'plot', 'visualise', 'visualize', 'visualization', 'progress', 'stats', 'statistics', 'trends'],
      learn: ['lists', 'sort'],
      tools: {
        python: [['Plotly', 'https://plotly.com/python/', 'Interactive charts.', 'pip install plotly'], ['Streamlit', 'https://streamlit.io/', 'Makes a dashboard from a Python script.', 'pip install streamlit']],
        swift: [['Swift Charts', apple('charts'), "Apple's chart library. A few lines give you a good chart."]],
        java: [['JFreeChart', 'https://www.jfree.org/jfreechart/', 'Makes charts as images.']],
        frontend: [['Chart.js', 'https://www.chartjs.org/', 'Simple, attractive charts.', 'npm install chart.js'], ['D3', 'https://d3js.org/', 'For custom charts, with more to learn.', 'npm install d3']],
        mainframe: [['ICETOOL', ibm('zos'), 'Totals and reports from files, with no code.']],
      },
    },
    {
      id: 'notify', label: 'Notifications', plain: 'Taps someone on the shoulder when something happens.',
      triggers: ['remind', 'reminder', 'reminders', 'notify', 'notification', 'notifications', 'alert', 'alerts', 'push'],
      learn: ['async'],
      tools: {
        python: [['Firebase Admin', 'https://firebase.google.com/docs/admin/setup', 'Sends push messages to phones.', 'pip install firebase-admin'], ['ntfy', 'https://ntfy.sh/', 'Sends a phone alert from a script in one line.']],
        swift: [['UserNotifications', apple('usernotifications'), 'Reminders and alerts on Apple devices.']],
        java: [['Firebase Cloud Messaging', 'https://firebase.google.com/docs/cloud-messaging', 'Push messages to Android and iPhone.']],
        frontend: [['Web Push', 'https://developer.mozilla.org/en-US/docs/Web/API/Push_API', 'Notifications from a website.']],
        mainframe: [['IBM MQ', ibm('ibm-mq'), 'Sends a message for another system to act on.']],
      },
    },
    {
      id: 'email', label: 'Sending email', plain: 'Sends messages to an inbox.', server: true,
      triggers: ['email', 'emails', 'e mail', 'mail me', 'newsletter', 'mailing list'],
      learn: ['async', 'errors'],
      tools: {
        python: [['Resend', 'https://resend.com/docs', 'A simple service for sending email.', 'pip install resend'], ['smtplib', 'https://docs.python.org/3/library/smtplib.html', 'Built into Python.']],
        swift: [['MessageUI', apple('messageui'), 'Opens an email for the person to send. To send by itself, use a server.']],
        java: [['Spring Mail', 'https://docs.spring.io/spring-framework/reference/integration/email.html', 'Sends email from a Spring service.']],
        frontend: [['Resend', 'https://resend.com/docs', 'A simple service for sending email.', 'npm install resend'], ['Nodemailer', 'https://nodemailer.com/', 'Sends email from Node.', 'npm install nodemailer']],
        mainframe: [['SMTP on z/OS', ibm('zos'), 'A job writes the email to a special output class.']],
      },
    },
    {
      id: 'schedule', label: 'Running on a schedule', plain: 'Runs by itself at set times.',
      triggers: ['every day', 'every night', 'every morning', 'every hour', 'every week', 'every month', 'daily', 'nightly', 'weekly', 'monthly', 'hourly', 'scheduled', 'on a schedule', 'cron', 'overnight', 'automatically'],
      learn: ['run', 'async'],
      tools: {
        python: [['APScheduler', 'https://apscheduler.readthedocs.io/', 'Schedules work inside a Python program.', 'pip install apscheduler'], ['Celery', 'https://docs.celeryq.dev/', 'Background jobs for bigger apps.', 'pip install celery']],
        swift: [['BackgroundTasks', apple('backgroundtasks'), "Asks iOS for time to work. The system chooses when, so it isn't exact."]],
        java: [['Spring scheduling', 'https://docs.spring.io/spring-framework/reference/integration/scheduling.html', 'Add `@Scheduled` to a method.'], ['Quartz', 'https://www.quartz-scheduler.org/', 'A heavier scheduler for complex timing.']],
        frontend: [['Vercel Cron', 'https://vercel.com/docs/cron-jobs', 'Calls your code on a schedule.'], ['node-cron', 'https://github.com/node-cron/node-cron', 'Schedules work in a long-running Node program.', 'npm install node-cron']],
        mainframe: [['Control-M or IBM Workload Scheduler', 'https://www.bmc.com/it-solutions/control-m.html', 'Runs thousands of jobs in order, night after night.']],
      },
    },
    {
      id: 'scrape', label: 'Reading websites', plain: 'Pulls information out of web pages. Check that the site allows it.',
      triggers: ['scrape', 'scraper', 'scraping', 'crawl', 'crawler', 'price tracker', 'track prices', 'prices from', 'monitor a website', 'from websites', 'from a website', 'pull data from'],
      learn: ['text', 'errors'],
      tools: {
        python: [['Beautiful Soup', 'https://www.crummy.com/software/BeautifulSoup/', 'Picks information out of HTML.', 'pip install beautifulsoup4'], ['Playwright', 'https://playwright.dev/python/', 'Drives a real browser, for sites that need JavaScript.', 'pip install playwright']],
        swift: [['SwiftSoup', 'https://github.com/scinfu/SwiftSoup', 'Picks information out of HTML.']],
        java: [['jsoup', 'https://jsoup.org/', 'Picks information out of HTML.']],
        frontend: [['Cheerio', 'https://cheerio.js.org/', 'Picks information out of HTML, in Node.', 'npm install cheerio'], ['Playwright', 'https://playwright.dev/', 'Drives a real browser.', 'npm install playwright']],
        mainframe: [],
      },
      none: { mainframe: "Not a mainframe job. Run it elsewhere, then send the file in." },
    },
    {
      id: 'calls', label: 'Using other services', plain: 'Gets data from somewhere else, like weather or stock prices.',
      triggers: ['weather', 'stock price', 'stock prices', 'exchange rate', 'third party', 'external api', 'call an api', 'use an api', 'integrate with', 'connect to', 'pull from', 'fetch data', 'news feed', 'rss', 'spotify', 'google calendar', 'slack', 'discord', 'telegram', 'twitter', 'github api'],
      learn: ['async', 'errors'],
      tools: {
        python: [['HTTPX', 'https://www.python-httpx.org/', 'Calls web APIs, with async support.', 'pip install httpx']],
        swift: [['URLSession', apple('foundation/urlsession'), 'Built in. Works with `async/await`.']],
        java: [['RestClient', 'https://docs.spring.io/spring-framework/reference/integration/rest-clients.html', "Spring's way to call APIs."], ['Jackson', 'https://github.com/FasterXML/jackson', 'Turns JSON into Java objects.']],
        frontend: [['fetch', 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API', 'Built into every browser and Node.'], ['TanStack Query', 'https://tanstack.com/query', 'Handles loading, caching and retries in React.', 'npm install @tanstack/react-query']],
        mainframe: [['z/OS Connect', ibm('zos-connect'), 'Lets COBOL call, and be called by, REST APIs.']],
      },
    },
    {
      id: 'realtime', label: 'Live updates', plain: 'Everyone sees changes straight away, with no refresh.', server: true,
      triggers: ['real time', 'realtime', 'live', 'chat', 'chat app', 'messaging', 'multiplayer', 'collaborate', 'collaborative', 'live scores', 'whiteboard'],
      learn: ['async', 'click'],
      tools: {
        python: [['Django Channels', 'https://channels.readthedocs.io/', 'Adds live connections to Django.', 'pip install channels'], ['FastAPI WebSockets', 'https://fastapi.tiangolo.com/advanced/websockets/', 'Live connections in FastAPI.']],
        swift: [['URLSessionWebSocketTask', apple('foundation/urlsessionwebsockettask'), 'Live connections from an Apple app.']],
        java: [['Spring WebSocket', 'https://docs.spring.io/spring-framework/reference/web/websocket.html', 'Live connections in Spring.']],
        frontend: [['Socket.IO', 'https://socket.io/', 'Live messages, with reconnecting handled.', 'npm install socket.io'], ['Supabase Realtime', 'https://supabase.com/docs/guides/realtime', 'Listen to database changes.']],
        mainframe: [],
      },
      none: { mainframe: 'CICS handles many users, but pushes nothing to a 3270 screen. This belongs in a front-end system.' },
    },
    {
      id: 'ai', label: 'AI text', plain: 'Uses a language model to answer, summarise or write.', server: ['python', 'java', 'frontend'],
      triggers: ['chatbot', 'ai', 'llm', 'gpt', 'claude', 'assistant', 'summarise', 'summarize', 'summary', 'answer questions', 'generate text', 'rag', 'embeddings'],
      learn: ['async', 'errors'],
      tools: {
        python: [['Anthropic SDK', 'https://github.com/anthropics/anthropic-sdk-python', 'Calls Claude from Python.', 'pip install anthropic']],
        swift: [['Foundation Models', apple('foundationmodels'), "Apple's on-device model. Free, private and offline, on newer devices."]],
        java: [['Anthropic Java SDK', 'https://github.com/anthropics/anthropic-sdk-java', 'Calls Claude from Java.'], ['LangChain4j', 'https://docs.langchain4j.dev/', 'Tools for building AI features in Java.']],
        frontend: [['AI SDK', 'https://ai-sdk.dev/', 'Streaming AI replies into a web page.', 'npm install ai'], ['Anthropic SDK', 'https://github.com/anthropics/anthropic-sdk-typescript', 'Calls Claude from Node.', 'npm install @anthropic-ai/sdk']],
        mainframe: [],
      },
      none: { mainframe: 'Run AI in a service off the mainframe, and call it through z/OS Connect or MQ.' },
    },
    {
      id: 'ml', label: 'Predictions', plain: 'Learns from past data to guess what comes next.',
      triggers: ['predict', 'prediction', 'predictions', 'forecast', 'machine learning', 'recommend', 'recommendation', 'recommendations', 'classify', 'classifier', 'train a model', 'neural network', 'fraud detection', 'detect fraud', 'spam filter'],
      learn: ['lists', 'sort'],
      tools: {
        python: [['scikit-learn', 'https://scikit-learn.org/', 'The place to start: classic models with little code.', 'pip install scikit-learn'], ['PyTorch', 'https://pytorch.org/', 'For deep learning.', 'pip install torch']],
        swift: [['Core ML', apple('coreml'), 'Runs a trained model on the device.'], ['Create ML', apple('createml'), 'Trains simple models on your Mac.']],
        java: [['Tribuo', 'https://tribuo.org/', 'Machine learning in Java, from Oracle.']],
        frontend: [['TensorFlow.js', 'https://www.tensorflow.org/js', 'Runs models in the browser.', 'npm install @tensorflow/tfjs']],
        mainframe: [['Machine Learning for z/OS', 'https://www.ibm.com/products/machine-learning-for-zos', 'Scores models right beside the transaction data.']],
      },
    },
    {
      id: 'vision', label: 'Understanding images', plain: 'Reads text from pictures, or spots what is in them.',
      triggers: ['ocr', 'scan', 'scanner', 'recognise', 'recognize', 'recognition', 'detect', 'detection', 'identify', 'barcode', 'qr code', 'read receipts', 'receipts', 'face'],
      learn: ['lists'],
      tools: {
        python: [['OpenCV', 'https://opencv.org/', 'The standard toolkit for working with images.', 'pip install opencv-python'], ['Tesseract', 'https://github.com/tesseract-ocr/tesseract', 'Reads text from images.']],
        swift: [['Vision', apple('vision'), 'Reads text, barcodes and faces on the device.']],
        java: [['Tess4J', 'https://github.com/nguyenq/tess4j', 'Tesseract from Java.']],
        frontend: [['Tesseract.js', 'https://tesseract.projectnaptha.com/', 'Reads text from images in the browser.', 'npm install tesseract.js']],
        mainframe: [],
      },
      none: { mainframe: 'Handled by front-end systems, which pass the results along.' },
    },
    {
      id: 'images', label: 'Photos and uploads', plain: 'People add photos or files, and you keep them.',
      triggers: ['upload', 'uploads', 'photo', 'photos', 'image', 'images', 'picture', 'pictures', 'gallery', 'attachment', 'attachments', 'avatar', 'share files', 'resize'],
      learn: ['files', 'input'],
      tools: {
        python: [['Pillow', 'https://pillow.readthedocs.io/', 'Resize and edit images.', 'pip install pillow'], ['boto3', 'https://boto3.amazonaws.com/v1/documentation/api/latest/index.html', 'Stores files in Amazon S3.', 'pip install boto3']],
        swift: [['PhotosUI', apple('photosui'), "Lets people pick from their photo library."]],
        java: [['Thumbnailator', 'https://github.com/coobird/thumbnailator', 'Resizes images.'], ['AWS SDK for Java', 'https://docs.aws.amazon.com/sdk-for-java/', 'Stores files in Amazon S3.']],
        frontend: [['Uppy', 'https://uppy.io/', 'A polished file upload box.', 'npm install uppy'], ['Vercel Blob', 'https://vercel.com/docs/vercel-blob', 'Simple file storage.', 'npm install @vercel/blob']],
        mainframe: [],
      },
      none: { mainframe: 'Mainframes hold records, not photos. Keep files elsewhere and store a reference.' },
    },
    {
      id: 'pdf', label: 'PDFs and documents', plain: 'Makes or reads PDF files.',
      triggers: ['pdf', 'pdfs', 'invoice', 'invoices', 'receipt pdf', 'statement', 'statements', 'certificate', 'word document', 'documents'],
      learn: ['files'],
      tools: {
        python: [['WeasyPrint', 'https://weasyprint.org/', 'Turns HTML and CSS into a PDF.', 'pip install weasyprint'], ['pypdf', 'https://pypdf.readthedocs.io/', 'Reads and splits PDFs.', 'pip install pypdf']],
        swift: [['PDFKit', apple('pdfkit'), 'Shows and edits PDFs on Apple devices.']],
        java: [['Apache PDFBox', 'https://pdfbox.apache.org/', 'Makes and reads PDFs.'], ['Apache Tika', 'https://tika.apache.org/', 'Pulls text from nearly any document.']],
        frontend: [['pdf-lib', 'https://pdf-lib.js.org/', 'Makes and edits PDFs in JavaScript.', 'npm install pdf-lib'], ['PDF.js', 'https://mozilla.github.io/pdf.js/', 'Shows PDFs in a page.', 'npm install pdfjs-dist']],
        mainframe: [['Report programs', ibm('cobol-zos'), 'Statements are printed from COBOL reports, often converted further along.']],
      },
    },
    {
      id: 'sheets', label: 'Spreadsheets and CSV', plain: 'Reads and writes Excel or CSV files.',
      triggers: ['excel', 'spreadsheet', 'spreadsheets', 'csv', 'xlsx', 'google sheets'],
      learn: ['files', 'lists'],
      tools: {
        python: [['pandas', 'https://pandas.pydata.org/', 'Reads CSV and Excel in one line.', 'pip install pandas openpyxl']],
        swift: [['TabularData', apple('tabulardata'), 'Reads CSV into a table.']],
        java: [['Apache POI', 'https://poi.apache.org/', 'Reads and writes Excel files.']],
        frontend: [['Papa Parse', 'https://www.papaparse.com/', 'Reads CSV in the browser.', 'npm install papaparse'], ['SheetJS', 'https://sheetjs.com/', 'Reads and writes Excel files.']],
        mainframe: [['DFSORT', ibm('zos'), 'Reformats fixed records into CSV for sending on.']],
      },
    },
    {
      id: 'maps', label: 'Maps and location', plain: 'Shows places, or works out where someone is.',
      triggers: ['map', 'maps', 'location', 'gps', 'nearby', 'near me', 'directions', 'route', 'delivery tracking', 'geolocation'],
      learn: ['lists', 'async'],
      tools: {
        python: [['Folium', 'https://python-visualization.github.io/folium/', 'Makes interactive maps from Python.', 'pip install folium'], ['geopy', 'https://geopy.readthedocs.io/', 'Turns addresses into coordinates.', 'pip install geopy']],
        swift: [['MapKit', apple('mapkit'), 'Maps in SwiftUI.'], ['Core Location', apple('corelocation'), 'Finds where the device is.']],
        java: [['Google Maps SDK', 'https://developers.google.com/maps/documentation/android-sdk', 'Maps on Android.']],
        frontend: [['MapLibre', 'https://maplibre.org/', 'Open-source, smooth web maps.', 'npm install maplibre-gl'], ['Leaflet', 'https://leafletjs.com/', 'Simple web maps.', 'npm install leaflet']],
        mainframe: [],
      },
      none: { mainframe: 'A mainframe might hold addresses, but maps belong in front-end systems.' },
    },
    {
      id: 'search', label: 'Search', plain: 'Finds things quickly by typing.',
      triggers: ['search', 'searchable', 'find products', 'filter', 'filters', 'autocomplete', 'look up', 'lookup'],
      learn: ['sort', 'maps'],
      tools: {
        python: [['PostgreSQL full text', 'https://www.postgresql.org/docs/current/textsearch.html', 'Good search, already inside your database.'], ['Meilisearch', 'https://www.meilisearch.com/', 'Fast search as a service you can run yourself.', 'pip install meilisearch']],
        swift: [['Core Spotlight', apple('corespotlight'), "Search your app's data on the device."]],
        java: [['Apache Lucene', 'https://lucene.apache.org/', 'The engine inside most search systems.']],
        frontend: [['Fuse.js', 'https://www.fusejs.io/', 'Forgiving search in the browser.', 'npm install fuse.js'], ['MiniSearch', 'https://lucaong.github.io/minisearch/', 'A tiny full-text search.', 'npm install minisearch']],
        mainframe: [['VSAM alternate index', ibm('zos'), 'Find records by a second key.']],
      },
    },
    {
      id: 'media', label: 'Audio and video', plain: 'Plays, records or streams sound and video.',
      triggers: ['video', 'videos', 'audio', 'music', 'podcast', 'streaming', 'record my voice', 'voice memo', 'transcribe', 'speech', 'voice', 'dictation'],
      learn: ['async', 'files'],
      tools: {
        python: [['FFmpeg', 'https://ffmpeg.org/', 'Converts and edits nearly any audio or video.'], ['Whisper', 'https://github.com/openai/whisper', 'Turns speech into text.', 'pip install openai-whisper']],
        swift: [['AVFoundation', apple('avfoundation'), 'Plays and records on Apple devices.'], ['Speech', apple('speech'), 'Turns speech into text on the device.']],
        java: [['ExoPlayer (Media3)', 'https://developer.android.com/media/media3', 'Plays media on Android.']],
        frontend: [['Video.js', 'https://videojs.com/', 'A reliable video player for the web.', 'npm install video.js'], ['Web Speech API', 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API', 'Speech built into browsers.']],
        mainframe: [],
      },
      none: { mainframe: "This isn't mainframe work." },
    },
    {
      id: 'calendar', label: 'Dates and bookings', plain: 'Handles times, slots and appointments.',
      triggers: ['calendar', 'booking', 'bookings', 'appointment', 'appointments', 'reservation', 'reservations', 'book a table', 'availability', 'timesheet'],
      learn: ['records', 'input'],
      tools: {
        python: [['datetime and zoneinfo', 'https://docs.python.org/3/library/zoneinfo.html', 'Built in. Always store times with a time zone.']],
        swift: [['EventKit', apple('eventkit'), "Reads and adds to the device's calendar."]],
        java: [['java.time', 'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/time/package-summary.html', 'Excellent date and time tools, built in.']],
        frontend: [['FullCalendar', 'https://fullcalendar.io/', 'A full calendar view.', 'npm install @fullcalendar/react'], ['date-fns', 'https://date-fns.org/', 'Small date helpers.', 'npm install date-fns']],
        mainframe: [['COBOL date functions', ibm('cobol-zos'), '`FUNCTION CURRENT-DATE` and `INTEGER-OF-DATE` handle date maths.']],
      },
    },
    {
      id: 'offline', label: 'Working offline', plain: 'Keeps working with no internet.',
      triggers: ['offline', 'without internet', 'no internet', 'local first', 'sync across', 'sync between', 'syncs'],
      learn: ['database', 'async'],
      tools: {
        python: [['SQLite', 'https://docs.python.org/3/library/sqlite3.html', 'A local database. Nothing to install.']],
        swift: [['SwiftData', apple('swiftdata'), 'Data lives on the device, and can sync through iCloud.']],
        java: [['Room', 'https://developer.android.com/training/data-storage/room', 'A local database on Android.']],
        frontend: [['Workbox', 'https://developer.chrome.com/docs/workbox', 'Makes a website work offline.', 'npm install workbox-window'], ['Dexie', 'https://dexie.org/', 'A friendly database in the browser.', 'npm install dexie']],
        mainframe: [],
      },
      none: { mainframe: 'Mainframes are always on. This belongs in the app in front of it.' },
    },
    {
      id: 'queue', label: 'Background work', plain: 'Passes jobs along to be done later, without losing any.', server: true,
      triggers: ['queue', 'queues', 'kafka', 'background job', 'background jobs', 'event driven', 'message broker', 'pub sub', 'rabbitmq'],
      learn: ['async', 'errors'],
      tools: {
        python: [['Celery', 'https://docs.celeryq.dev/', 'Background jobs.', 'pip install celery']],
        swift: [],
        java: [['Apache Kafka', 'https://kafka.apache.org/', 'High-volume streams of events.'], ['Spring for Apache Kafka', 'https://spring.io/projects/spring-kafka', 'Kafka from Spring.']],
        frontend: [['BullMQ', 'https://docs.bullmq.io/', 'Background jobs using Redis.', 'npm install bullmq']],
        mainframe: [['IBM MQ', ibm('ibm-mq'), 'The trusted message queue on z/OS.']],
      },
      none: { swift: 'Do this on a server, not in the app.' },
    },
    {
      id: 'batchfile', label: 'Processing big files', plain: 'Goes through huge files of records, one at a time.',
      triggers: ['batch', 'records', 'master file', 'flat file', 'fixed width', 'fixed length', 'payroll', 'settlement', 'statements', 'reconcile', 'reconciliation', 'interest calculation', 'update balances', 'balances', 'transactions file', 'overnight'],
      learn: ['files', 'sort', 'numbers'],
      tools: {
        python: [['Polars', 'https://pola.rs/', 'Very fast tables, even for files bigger than memory.', 'pip install polars']],
        swift: [],
        java: [['Spring Batch', 'https://spring.io/projects/spring-batch', 'Restartable batch jobs in Java.']],
        frontend: [['Node streams', 'https://nodejs.org/api/stream.html', 'Reads big files a piece at a time.']],
        mainframe: [['COBOL', ibm('cobol-zos'), 'Reads a record, updates it, and moves on. This is its home.'], ['DFSORT', ibm('zos'), 'Sorts and filters files before your program sees them.'], ['Control-M or IBM Workload Scheduler', 'https://www.bmc.com/it-solutions/control-m.html', 'Runs it in the right order each night.']],
      },
      none: { swift: "Not Swift's strength. Use a server." },
    },
    {
      id: 'bridge', label: 'Connecting to a mainframe', plain: 'Lets new apps use mainframe data and programs.',
      triggers: ['legacy', 'modernise', 'modernize', 'migrate', 'migration', 'expose mainframe', 'mainframe data', 'connect to the mainframe', 'from the mainframe', 'to the mainframe', 'zowe'],
      learn: ['run', 'database'],
      tools: {
        python: [['Zowe client for Python', 'https://github.com/zowe/zowe-client-python-sdk', 'Reach z/OS from Python.', 'pip install zowe']],
        swift: [],
        java: [['IBM MQ for Java', ibm('ibm-mq'), 'Talks to the mainframe through queues.'], ['JDBC for Db2', ibm('db2-for-zos'), 'Reads Db2 directly.']],
        frontend: [['Zowe CLI', 'https://www.zowe.org/', 'Runs mainframe work from a normal terminal.', 'npm install -g @zowe/cli']],
        mainframe: [['z/OS Connect', ibm('zos-connect'), 'Puts a REST API in front of COBOL.'], ['IBM MQ', ibm('ibm-mq'), 'Reliable messages between old and new systems.'], ['Zowe', 'https://www.zowe.org/', 'Use VS Code and modern tools on z/OS.']],
      },
      none: { swift: 'Apps call an API in front of the mainframe, so use URLSession.' },
    },
    {
      id: 'secure', label: 'Keeping data safe', plain: 'Protects private information.',
      triggers: ['encrypt', 'encrypted', 'encryption', 'secure', 'privacy', 'private', 'secrets', 'password manager', 'sensitive data', 'medical records', 'hipaa', 'gdpr'],
      learn: ['errors', 'input'],
      tools: {
        python: [['cryptography', 'https://cryptography.io/', 'Well-tested encryption. Never write your own.', 'pip install cryptography']],
        swift: [['CryptoKit', apple('cryptokit'), 'Encryption built into Apple devices.'], ['Keychain', apple('security/keychain-services'), 'The right place for passwords and keys.']],
        java: [['Bouncy Castle', 'https://www.bouncycastle.org/', 'A trusted encryption library.']],
        frontend: [['Web Crypto', 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API', 'Encryption built into browsers.']],
        mainframe: [['RACF', ibm('zos'), 'Decides who can reach what.'], ['Pervasive encryption', ibm('zos'), 'Encrypts datasets, with no program changes.']],
      },
    },
    {
      id: 'health', label: 'Health data', plain: 'Reads steps, heart rate and workouts.',
      triggers: ['steps', 'heart rate', 'apple health', 'healthkit', 'sleep tracking', 'fitness'],
      learn: ['records'],
      tools: {
        python: [],
        swift: [['HealthKit', apple('healthkit'), 'Reads and saves health data, with the person\'s permission.']],
        java: [['Health Connect', 'https://developer.android.com/health-and-fitness/guides/health-connect', 'The Android equivalent.']],
        frontend: [],
        mainframe: [],
      },
      none: { python: 'Health data lives on the phone, so it needs a phone app.', frontend: 'Websites cannot reach this. It needs a phone app.', mainframe: "This isn't mainframe work." },
    },
    {
      id: 'hardware', label: 'Sensors and devices', plain: 'Talks to Bluetooth gadgets or small boards.',
      triggers: ['bluetooth', 'sensor', 'sensors', 'iot', 'raspberry pi', 'arduino', 'smart home', 'homekit'],
      learn: ['async'],
      tools: {
        python: [['gpiozero', 'https://gpiozero.readthedocs.io/', 'Controls pins on a Raspberry Pi.', 'pip install gpiozero'], ['Bleak', 'https://github.com/hbldh/bleak', 'Bluetooth from Python.', 'pip install bleak']],
        swift: [['Core Bluetooth', apple('corebluetooth'), 'Connects to Bluetooth devices.'], ['HomeKit', apple('homekit'), 'Controls smart home devices.']],
        java: [['Android Bluetooth', 'https://developer.android.com/develop/connectivity/bluetooth', 'Bluetooth on Android.']],
        frontend: [['Web Bluetooth', 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API', 'Bluetooth from a browser, in Chrome only.']],
        mainframe: [],
      },
      none: { mainframe: "This isn't mainframe work." },
    },
  ];

  // Every project should have these, whatever it does.
  const habits = {
    python: [['pytest', 'https://docs.pytest.org/', 'Checks your code still works.', 'pip install pytest']],
    swift: [['Swift Testing', apple('testing'), 'Tests, built into Xcode.']],
    java: [['JUnit', 'https://junit.org/', 'The standard for Java tests.']],
    frontend: [['Vitest', 'https://vitest.dev/', 'Fast tests for TypeScript.', 'npm install -D vitest']],
    mainframe: [['Zowe Explorer', 'https://www.zowe.org/', 'Edit datasets and submit jobs from VS Code.']],
  };

  // Apps can't safely hold secret keys, or reach other people's devices by
  // themselves. When a project needs that, the plan adds one of these.
  const server = {
    python: [['FastAPI', 'https://fastapi.tiangolo.com/', 'A small Python server your app can call.', 'pip install "fastapi[standard]"']],
    swift: [['Supabase', 'https://supabase.com/', 'A hosted server and database, with a Swift library.'], ['Vapor', 'https://vapor.codes/', 'Or write your own server in Swift.']],
    java: [['Spring Boot', 'https://spring.io/projects/spring-boot', 'A Java server your app can call.'], ['Firebase', 'https://firebase.google.com/', 'A hosted server, popular on Android.']],
    frontend: [['Supabase', 'https://supabase.com/', 'A hosted server and database.', 'npm install @supabase/supabase-js'], ['Hono', 'https://hono.dev/', 'Or write your own small server.', 'npm create hono@latest']],
    mainframe: [],
  };

  // Words that show up in descriptions and tell us nothing. Used to report what
  // wasn't understood, so a thin result is honest rather than confident.
  const filler = new Set(`a an the and or but for to of in on at by with from into that this these those it its i me my we our you your they them their
    he she his her is are was were be been being am do does did have has had will would can could should may might must shall want wants wanted need needs like
    make makes making build building builds create creating let lets allow allows help helps get gets got use using used app apps application tool tools thing things something
    some any all each every when where what who how why which while so if then than also just very really quite simple small little big new easy nice good great
    people person someone everyone user users one two three as about over under up down out not no way ways show shows see sees look looks give gives put takes take
    work works working run runs running them there here have try page site
    ready done time place lot lots many much more most own home day today sure able kind sort stuff`.split(/\s+/));

  (root.Cuecode ??= {}).finderData = { routes, shapes, caps, habits, server, filler };
})(globalThis);
