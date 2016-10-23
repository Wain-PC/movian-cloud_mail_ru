/**
 * cloud.mail.ru plugin for Showtime
 *
 *  Copyright (C) 2016 Wain
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

var plugin = this,
    PREFIX = 'cloud_mail_ru',
    BASE_URL = 'https://cloud.mail.ru',
    logo = plugin.path + "logo.png",
    html = require('showtime/html'),
    io = require('native/io'),
    token,
    shardUrl;

plugin.createService(plugin.getDescriptor().id, PREFIX + ":start:false", "video", true, logo);


function setPageHeader(page, title) {
    if (page.metadata) {
        page.metadata.title = title;
        page.metadata.logo = logo;
    }
    page.type = "directory";
    page.contents = "items";
    page.loading = false;
}

function getShardUrl(page) {
    var result = apiCall(page,'dispatcher');
    console.log(JSON.stringify(result));
 return shardUrl = apiCall(page,'dispatcher').body.get[0].url;
}

function makeRequest(page, url, settings, extendedMode) {
    var response;
    if (!url) {
        return showtime.message('NO_URL_IN_REQUEST');
    }
    if (!page) {
        return showtime.message('NO_PAGE_OBJECT_IN_REQUEST');
    }
    if (!settings) {
        settings = {
            method: 'GET'
        };
    }

    page.loading = true;

    response = showtime.httpReq(url, settings);
    page.loading = false;
    if (extendedMode) {
        return {
            dom: html.parse(response.toString()).root,
            body: response.toString(),
            status: response.statusCode,
            headers: response.headers
        }
    }
    return html.parse(response.toString()).root;

}


function findItems(page, data) {

    console.log(JSON.stringify(data));

    var items = data.body.list, item, i, length = items.length;
    for (i = 0; i < length; i++) {
        item = items[i];
        if (item.kind === 'folder') {
            page.appendItem(PREFIX + ':folder:' + encodeURIComponent(item.home) + ':' + encodeURIComponent(item.name), 'directory', {
                title: new showtime.RichText(item.name)
            });
        }
        else if(item.kind === 'file') {
            page.appendItem(shardUrl + encodeURIComponent(item.home.substr(1)) + '?x-email=wain-pc%40mail.ru', 'item', {
                title: new showtime.RichText(item.name)
            });
        }
    }
}


function performLoginAttempt(page, showLoginWindow) {
    //var credentials = plugin.getAuthCredentials(plugin.getDescriptor().synopsis, "Логин", showLoginWindow),
    var creditentials = {
            username: 'login@mail.ru',
            password: 'password'
        },
        response,
        result = {
            result: false,
            response: null,
            rejected: false
        };
    /*if (credentials.rejected) { //rejected by user
     result.rejected = true;
     return result;
     }*/
    if (creditentials && creditentials.username && creditentials.password) {
        response = makeRequest(page, 'https://auth.mail.ru/cgi-bin/auth', {
            method: 'POST',
            postdata: {
                'Login': creditentials.username,
                'Password': creditentials.password
            },
            noFollow: true
        }, true);


        if (!(response.headers['Location'] && response.headers['Location'].match(/inbox/))) {
            result.response = response;
            return result;
        }
        makeRequest(page, 'https://auth.mail.ru/sdc?from=https://cloud.mail.ru/home');
        response = makeRequest(page, 'https://cloud.mail.ru/api/v2/tokens/csrf',null,true);
        console.log(response.body);
        token = JSON.parse(response.body).body.token;

        if (token) {
            result.result = true;
            getShardUrl(page);
        }
        result.response = response;
    }
    return result;
}


function performLogout(page) {
    makeRequest(page, BASE_URL + '/index.php?action=logout', {
        noFollow: true
    });
    page.redirect(PREFIX + ":start:true");
}

function apiCall(page, methodName, options) {
    var opts = {
        method: 'POST',
        postdata: {
            token: token
        }
    }, optionName, response;

    for (optionName in options) {
        if (options.hasOwnProperty(optionName)) {
            opts.postdata[optionName] = options[optionName];
        }
    }

    console.log("OPTIONS:"+ JSON.stringify(opts));

    response = makeRequest(page, 'https://cloud.mail.ru/api/v2/' + methodName, opts, true);
    return JSON.parse(response.body);
}


plugin.addURI(PREFIX + ":logout", function (page) {
    performLogout(page);
});


plugin.addURI(PREFIX + ":start:(.*)", function (page, forceAuth) {
    setPageHeader(page, plugin.getDescriptor().synopsis);
    var loginSuccess = !(forceAuth === 'true'),
        loginResult,
        response;

/*    while (true) {
        loginResult = performLoginAttempt(page, !loginSuccess);
        if (loginResult.rejected) {
            return;
        }
        loginSuccess = loginResult.result;
        response = loginResult.response;
        if (loginSuccess) break;
        loginSuccess = false;
    }*/

    loginResult = performLoginAttempt(page, !loginSuccess);
    if (loginResult.rejected || !loginResult.result) {
        showtime.message('LOGIN_FAILED');
    }

    //добавим возможность логаута
    page.appendItem(PREFIX + ":logout", "directory", {
        title: new showtime.RichText("Выйти из аккаунта")
    });

    //запросим список файлов для корня
    page.redirect(PREFIX + ':folder:/:Root');

});

plugin.addURI(PREFIX + ":folder:(.*):(.*)", function (page, path, title) {
    path = decodeURIComponent(path);
    title = decodeURIComponent(title);
    setPageHeader(page, title);
    var data = apiCall(page, 'folder', {home: path});
    findItems(page, data);
});



plugin.addSearcher(plugin.getDescriptor().id, logo, function (page, query) {
    var pageNum = 1,
        paginator = function () {

            var dom = makeRequest(page, BASE_URL + '/index.php?do=search', {
                    postdata: {
                        subaction: 'search',
                        do: 'search',
                        full_search: 0,
                        search_start: pageNum,
                        result_from: page.entries + 1,
                        story: unicode2win1251(query)
                    }
                }),
                hasNextPage;
            findItems(page, dom, true);
            hasNextPage = findNextPage(dom, true);
            if (hasNextPage) {
                pageNum++;
            }
            return !!hasNextPage;

        };
    page.entries = 0;
    page.paginator = paginator;
    performLoginAttempt(page);
    paginator();
});