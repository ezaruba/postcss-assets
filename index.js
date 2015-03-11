var vendor = require('postcss/lib/vendor');

var mapFunctions = require('./lib/mapFunctions');
var parseBytes = require('./lib/parseBytes');
var unescapeCss = require('./lib/unescapeCss');

var fs = require('fs');
var path = require('path');
var url = require('url');

var cssesc = require('cssesc');
var SVGEncoder = require("directory-encoder/lib/svg-uri-encoder.js");
var mime = require('mime');
var sizeOf = require('image-size');

module.exports = function (options) {

  var inputPath;

  options = options || {};
  options.baseUrl = options.baseUrl || '/';

  if (options.basePath) {
    options.basePath = path.resolve(options.basePath);
  } else {
    options.basePath = process.cwd();
  }

  if (options.loadPaths) {
    options.loadPaths = options.loadPaths.map(function (loadPath) {
      return path.resolve(options.basePath, loadPath);
    });
  } else {
    options.loadPaths = [];
  }
  options.loadPaths.unshift(options.basePath);

  if (options.relativeTo) {
    options.relativeTo = path.resolve(options.relativeTo);
  } else {
    options.relativeTo = false;
  }

  if (options.cachebuster === true) {
    options.cachebuster = function (path) {
      var mtime = fs.statSync(path).mtime;
      return mtime.getTime().toString(16);
    };
  }

  function getImageSize(assetStr, density) {
    var assetPath = resolvePath(assetStr.value);
    var size;
    try {
      size = sizeOf(assetPath);
      if (typeof density !== 'undefined') {
        density = parseFloat(density.value, 10);
        size.width  = +(size.width  / density).toFixed(4);
        size.height = +(size.height / density).toFixed(4);
      }
      return size;
    } catch (exception) {
      var err = new Error("Image corrupted: " + assetPath);
      err.name = 'ECORRUPT';
      throw err;
    }
  }

  function matchPath(assetPath) {
    var exception, matchingPath;
    if (typeof inputPath === 'string') {
      var loadPaths = [path.dirname(inputPath)].concat(options.loadPaths);
    } else {
      loadPaths = options.loadPaths;
    }
    var isFound = loadPaths.some(function (loadPath) {
      matchingPath = path.join(loadPath, assetPath);
      return fs.existsSync(matchingPath);
    });
    if (!isFound) {
      exception = new Error("Asset not found or unreadable: " + assetPath);
      exception.name = 'ENOENT';
      throw exception;
    }
    return matchingPath;
  }

  function resolveDataUrl(assetStr) {
    var resolvedPath = resolvePath(assetStr);
    var mimeType = mime.lookup(resolvedPath);

    if (mimeType === 'image/svg+xml') {
      return (new SVGEncoder(resolvedPath)).encode();
    } else {
      var data = new Buffer(fs.readFileSync(resolvedPath), 'binary').toString('base64');

      return 'data:' + mimeType + ';base64,' + data;
    }
  }

  function resolvePath(assetStr) {
    var assetUrl = url.parse(unescapeCss(assetStr));
    var assetPath = decodeURI(assetUrl.pathname);
    return matchPath(assetPath);
  }

  function resolveUrl(assetStr) {
    var assetUrl = url.parse(unescapeCss(assetStr));
    var assetPath = decodeURI(assetUrl.pathname);
    if (options.relativeTo) {
      assetUrl.pathname = path.relative(options.relativeTo, matchPath(assetPath));
    } else {
      var baseToAsset = path.relative(options.basePath, matchPath(assetPath));
      assetUrl.pathname = url.resolve(options.baseUrl, baseToAsset);
    }
    if (options.cachebuster) {
      if (assetUrl.search) {
        assetUrl.search = assetUrl.search + '&';
      } else {
        assetUrl.search = '?';
      }
      assetUrl.search += options.cachebuster(resolvePath(assetPath));
    }
    return cssesc(url.format(assetUrl));
  }

  return function (cssTree) {
    cssTree.eachDecl(function (decl) {

      inputPath = decl.source.input.file;

      try {
        decl.value = mapFunctions(decl.value, {
          'resolve': function (assetStr) {
            assetStr.value = resolveUrl(assetStr.value);
            return 'url(' + assetStr + ')';
          },

          'inline': function (assetStr) {
            assetStr.value = resolveDataUrl(assetStr.value);
            return 'url(' + assetStr + ')';
          },

          'width': function (assetStr, density) {
            return getImageSize(assetStr, density).width  + 'px';
          },

          'height': function (assetStr, density) {
            return getImageSize(assetStr, density).height + 'px';
          },

          'size': function (assetStr, density) {
            var size = getImageSize(assetStr, density);
            return size.width + 'px ' + size.height + 'px';
          }
        });
      } catch (exception) {
        switch (exception.name) {
        case 'ECORRUPT':
          throw decl.error(exception.message);
        case 'ENOENT':
          throw decl.error(exception.message + '\nLoad paths:\n  ' + options.loadPaths.join('\n  '));
        default:
          throw exception;
        }
      }
    });
  };
};

module.exports.postcss = function (cssTree) {
  module.exports()(cssTree);
};
