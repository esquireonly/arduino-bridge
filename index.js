const util = require('util');

(async () => {
    let plugin;
    let app;

    try {
        app = require('./app');
        const opt = JSON.parse(process.argv[2] || '{}');
        plugin = require((opt.pluginapi || './pluginapi_mock') + '/index.js')();
        plugin.log('Плагин arduino_bridge стартовал');
        plugin.startOptions = opt;
    } catch (err) {
        const txt = 'Ошибка при инициализации: ' + util.inspect(err);
        if (process.send) process.send({ type: 'debug', txt });
        process.exit(255);
    }

    try {
        plugin.params.data = await plugin.params.get();
        plugin.log('Получены параметры: ' + util.inspect(plugin.params.data));

        if (plugin.logger && plugin.logger.setParams) {
            plugin.logger.setParams({
                logsize: plugin.params.data?.logsize || 500,
                logrotate: plugin.params.data?.logrotate || 3
            });
        }

        app(plugin);
    } catch (err) {
        plugin.exit(8, 'Error: ' + util.inspect(err));
    }
})();