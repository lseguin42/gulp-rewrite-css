/// <reference path="../typings/index.d.ts" />

import es = require('event-stream');
import path = require('path');
import url = require('url');
import gutil = require('gulp-util');
import css = require('css');
import File = require('vinyl');
import stream = require('stream');

const BufferStreams: any = require('bufferstreams');

const magenta = gutil.colors.magenta;
const green = gutil.colors.green;

const PLUGIN_NAME = 'rewrite-css';

function wrapUrl(url: string) {
    return 'url("' + url.replace('"', '\"') + '")';
}

function replaceDeclarationUrl(str: string, replace: (url: string) => string) {
    const URL_REGEX = /url\s*\(\s*(?!["']?data:)([^\)]+)\)/g;
    return str.replace(URL_REGEX, function () {
        return wrapUrl(replace(cleanMatch(arguments[1])));
    });
}

function replaceImportUrl(str: string, replace: (url: string) => string) {
    const IMPORT_REGEX = /^(url\s*\(\s*(?!["']?data:)([^\)]+)\))|((["'])\s*([^'"]+)\4)/;
    return str.replace(IMPORT_REGEX, function () {
        return wrapUrl(replace(cleanMatch(arguments[2] || arguments[5])));
    });
}

function cleanMatch(url: string): string {
    url = url.trim();
    let firstChar = url.substr(0, 1);
    if (firstChar === (url.substr(-1)) && (firstChar === '"' || firstChar === "'")) {
        url = url.substr(1, url.length - 2);
    }
    return url;
}

function isRelativeUrl(u: string): boolean {
    let parts = url.parse(u, false, true);
    return !parts.protocol && !parts.host;
}

function isRelativeToBase(u: string): boolean {
    return '/' === u.substr(0, 1);
}

export = function rewriteCss(transformFn: (targetFile: string, context: {
    sourceDir: string
    sourceFile: string
    isRelativeUrl: boolean
    isRelativeToBase: boolean
    isImportUrl: boolean
}) => string) {
    let opt = {
        debug: false
    };

    if (typeof transformFn !== 'function') {
        throw new gutil.PluginError(PLUGIN_NAME, 'adaptPath method is mssing');
    }

    function mungePath(sourceFilePath: string, file: string, isImportUrl: boolean) {
        let sourceDir = path.dirname(sourceFilePath);
        return transformFn(file, {
            sourceDir: sourceDir,
            sourceFile: sourceFilePath,
            isRelativeUrl: isRelativeUrl(file),
            isRelativeToBase: isRelativeToBase(file),
            isImportUrl: isImportUrl
        });
    }

    function logRewrite(match: string, sourceFilePath: string, destinationFilePath: string) {
        if (opt.debug) {
            return gutil.log(magenta(PLUGIN_NAME), 'rewriting path for', magenta(match), 'in', magenta(sourceFilePath), 'to', green(destinationFilePath));
        }
    }

    function rewriteUrls(sourceFilePath: string, cssDocument: css.Stylesheet) {
        cssDocument.stylesheet.rules.forEach(function(rule: any) {
            if ((rule).declarations) {
                rule.declarations.forEach(function (declaration: any) {
                    if (declaration.type === 'declaration') {
                        declaration.value = replaceDeclarationUrl(declaration.value, function (url) {
                            return mungePath(sourceFilePath, url, false);
                        });
                    }
                });
            } else if (rule.type === 'import') {
                rule.import = replaceImportUrl(rule.import, function (url) {
                    return mungePath(sourceFilePath, url, true);
                });
            }
        });
        return css.stringify(cssDocument);
    }

    function bufferReplace(file: File, data: string) {
        return rewriteUrls(file.path, css.parse(data));
    }

    function streamReplace(file: File) {
        var count = 0;
        return function(err: Error, buf: Buffer, cb: Function) {
            if (err) {
                cb(new gutil.PluginError(PLUGIN_NAME, err));
            }
            buf = new Buffer(bufferReplace(file, String(buf)));
            cb(null, buf);
        };
    }

    return es.map((file: File, callback: Function) => {
        if (file.isNull()) {
            callback(null, file);
            return;
        }
        if (file.isStream()) {
            file.contents = (<any>file.contents).pipe(new BufferStreams(streamReplace(file)));
            callback(null, file);
            return;
        }
        if (file.isBuffer()) {
            let newFile = file.clone();
            let newContents = bufferReplace(file, String(newFile.contents));
            newFile.contents = new Buffer(newContents);
            callback(null, newFile);
        }
    });
};