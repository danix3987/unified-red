const fs = require('fs');
const path = require('path');
const configFilePath = path.resolve(__dirname + '/../config.json');
const config = require(configFilePath);
const db = require('../db');
const emailService = require('../email.service');
let settings;
let log;

module.exports = {
    init,
    isInstalled,
    isDbConnected,
    install,
    testDbConnection,
    testSmtpServer,
};

function init(_log, _settings) {
    log = _log;
    settings = _settings;
}

async function isInstalled() {
    if (
        settings &&
        settings.adminAuth && settings.adminAuth.isUnified &&
        settings.httpStatic &&
        settings.httpAdminRoot && settings.httpAdminRoot === '/admin/' &&
        (!settings.httpRoot || settings.httpRoot === '/') &&
        settings.ui && settings.ui.path && settings.ui.path === '/' &&
        config &&
        config.dbConnection &&
        config.jwtsecret &&
        config.smtp.host
    ) {
        return true;
    }
    return false;
}

async function isDbConnected() {
    return db.status() === 'connected';
}

async function install(setup) {
    // Since install API is not protected (i.e. it's a public API), installation should only be allowed once.
    // After install, block further install changes
    if (await isInstalled()) {
        return { result: false, message: 'Already installed' };
    }
    try {
        // Add settings to config.json file
        if (setup.dbConnection || setup.jwtsecret || setup.smtp) {
            if (setup.dbConnection) {
                config.dbConnection = setup.dbConnection;
            }
            if (setup.jwtsecret) {
                config.jwtsecret = setup.jwtsecret;
            }
            if (setup.smtp) {
                config.smtp = setup.smtp;
            }
            log.info('Unified-RED applying settings to config.json');
            fs.writeFileSync(configFilePath, JSON.stringify(config, null, 4));
        }

        // Add settings to Node-RED settings file
        let data = fs.readFileSync(settings.settingsFile, { encoding: 'utf8' });
        if ((!settings.adminAuth || !settings.adminAuth.isUnified) || setup.adminAuthPath) {
            log.info('Self-installing Unified-RED adminAuth hook on ' + settings.settingsFile);
            let defaultAdminAuthPath = path.resolve(__dirname + '/../../admin-auth');
            let adminAuthPath = setup.adminAuthPath || defaultAdminAuthPath;
            let findAdminAuth = (str) => {
                try {
                    let adminAuthRegex = /\s+(\/\/[\s]*)?adminAuth\s*:\s*\{/gi;
                    let matches = adminAuthRegex.exec(str);
                    if (matches.length) {
                        let start = str.search(adminAuthRegex);
                        let firstBrace = start + matches[0].length;
                        let stack = [firstBrace];
                        let i = firstBrace;
                        for (; i < str.length; i++) {
                            let c = str.charAt(i);
                            if (c === '{') {
                                stack.push(i);
                            }
                            else if (c === '}') {
                                stack.pop();
                                if (!stack.length) {
                                    break;
                                }
                            }
                        }
                        return { start: start, end: i+1 };
                    }
                }
                catch (ignore) {}
            };
            let pos = findAdminAuth(data);
            if (pos && typeof pos.start !== 'undefined' && typeof pos.end !== 'undefined') {
                let commentedAdminAuth = data.substring(pos.start, pos.end).replace(/[\n\r]+/g, "\n//");
                data = data.substring(0, pos.start) + '\n    adminAuth: require("' + adminAuthPath + '"),' + commentedAdminAuth + data.substring(pos.end);
            }
        }
        if (!settings.httpStatic || setup.staticPath || settings.httpStatic === '/usr/bin/apollo/node-red/js') {
            log.info('Self-installing Unified-RED static folder path on ' + settings.settingsFile);
            let defaultStaticPath = path.resolve(__dirname + '/../../static/');
            let staticPath = setup.staticPath || defaultStaticPath;
            data = data.replace(/(\/\/[\s]*)?(httpStatic[\s]*\:.*\n)/i, 'httpStatic: "' + staticPath + '",\n// $2');
        }
        if (!settings.httpAdminRoot || settings.httpAdminRoot !== '/admin/') {
            log.info('Setting Node-RED httpAdminRoot path on ' + settings.settingsFile);
            data = data.replace(/(\/\/[\s]*)?(httpAdminRoot[\s]*\:.*\n)/i, 'httpAdminRoot: "/admin/",\n// $2');
        }
        if (settings.httpRoot !== '/') {
            log.info('Removing Node-RED httpRoot setting');
            data = data.replace(/(\/\/[\s]*)?(httpRoot[\s]*\:.*\n)/i, '// $2');
        }
        if (!settings.ui || !settings.ui.path || settings.ui.path !== '/') {
            log.info('Setting Node-RED ui path on ' + settings.settingsFile);
            data = data.replace(/(\/\/[\s]*)?(ui[\s]*\:.*\n)/i, 'ui: { path: "/" },\n// $2');
        }
        fs.writeFileSync(settings.settingsFile, data, { encoding: 'utf8' });

        let successStr = 'Installation complete. Shutting down Node-RED in 5 seconds...';
        log.info(successStr);
        setTimeout(function () {
            process.exit();
        }, 5000);
        return { result: true, message: successStr };
    } catch (e) {
        log.info('--- Unified-RED installation error:');
        log.info(e);
        log.info('---');
        return { result: false, message: e.message };
    }
}

async function testDbConnection(dbConnection) {
    try {
        await db.test(dbConnection);
        return { result: true };
    } catch (error) {
        return { result: false, error: error.message };
    }
}

async function testSmtpServer(smtp) {
    try {
        let r = await emailService.test(smtp.host, smtp.port, smtp.ssl, smtp.fromAddress, smtp.user, smtp.password);
        return { result: true };
    } catch (error) {
        return { result: false, error: error.message };
    }
}
