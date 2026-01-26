/* eslint-disable no-redeclare */
/* global module */

module.exports = function(grunt) {
    /* eslint-disable no-undef */
    const dateFormat = require('dateformat');

    // ----------
    grunt.loadNpmTasks("grunt-contrib-compress");
    grunt.loadNpmTasks("grunt-contrib-concat");
    grunt.loadNpmTasks("grunt-contrib-uglify");
    grunt.loadNpmTasks("grunt-contrib-qunit");
    grunt.loadNpmTasks("grunt-contrib-connect");
    grunt.loadNpmTasks("grunt-contrib-watch");
    grunt.loadNpmTasks("grunt-contrib-clean");
    grunt.loadNpmTasks("grunt-eslint");
    grunt.loadNpmTasks("grunt-git-describe");
    grunt.loadNpmTasks('grunt-text-replace');
    grunt.loadNpmTasks('grunt-istanbul');

    // ----------
    const packageJson = grunt.file.readJSON("package.json"),
        distribution = "build/openseadragon/flex-renderer.js",
        minified = "build/openseadragon/flex-renderer.min.js",
        packageDirName = "flex-renderer-bin-" + packageJson.version,
        packageDir = "build/" + packageDirName + "/",
        releaseRoot = "../site-build/built-openseadragon/",
        coverageDir = 'coverage/' + dateFormat(new Date(), 'yyyymmdd-HHMMss'),
        sources = [
            "src/flex-renderer.js",
            "src/colormaps.js",
            "src/flex-shader-layer.js",
            "src/flex-controls/basic-controls.js",
            "src/flex-controls/advanced-controls.js",
            "src/flex-webgl-context.js",
            "src/flex-webgl2.js",
            "src/flex-drawer.js",
            "src/flex-standalone.js",
            "src/flex-layers/bipolar-heatmap.js",
            "src/flex-layers/colormap.js",
            "src/flex-layers/default.js",
            "src/flex-layers/edge-isoline.js",
            "src/flex-layers/heatmap.js",
            "src/flex-layers/sobel.js",
            "src/flex-layers/texture.js",
            "src/flex-layers/time-series.js",
            "src/mvt-tile-source.js",
            "src/fabric-tile-source.js",
        ],
        mvtWorkerDeps = [
            "src/vendor/pbf.min.js",
            "src/vendor/vector-tile.min.js",
            "src/vendor/earcut.min.js",
            "src/workers/mvt-worker.core.js"
        ],
        fabricWorkerDeps = [
            "src/vendor/earcut.min.js",
            "src/workers/fabric-worker.core.js"
        ];

    const banner = "//! <%= pkg.name %> <%= pkg.version %>\n" +
                 "//! Built on <%= grunt.template.today('yyyy-mm-dd') %>\n" +
                 "//! Git commit: <%= gitInfo %>\n" +
                 "//! http://openseadragon.github.io\n" +
                 "//! License: http://openseadragon.github.io/license/\n\n";

    // ----------
    grunt.event.once('git-describe', function (rev) {
        grunt.config.set('gitInfo', rev);
    });

    let moduleFilter =  '';
    if (grunt.option('module')) {
        moduleFilter = '?module=' + grunt.option('module');
    }

    // ----------
    // Project configuration.
    grunt.initConfig({
        pkg: packageJson,
        osdVersion: {
            versionStr: packageJson.version,
            major:      parseInt(packageJson.version.split('.')[0], 10),
            minor:      parseInt(packageJson.version.split('.')[1], 10),
            revision:   parseInt(packageJson.version.split('.')[2], 10)
        },
        clean: {
            build: ["build"],
            package: [packageDir],
            coverage: ["instrumented"],
            release: {
                src: [releaseRoot],
                options: {
                    force: true
                }
            }
        },
        concat: {
            options: {
                banner: banner,
                sourceMap: true,
                process: true
            },
            mvtWorkerPre: {
                options: { sourceMap: false, banner: "" },
                src: mvtWorkerDeps,
                dest: "build/openseadragon/mvt-worker.js"
            },
            mvtWorkerPost: {
                options: {
                    process: function (content/*, srcPath*/) {
                        // Escape backticks and ${ in template literals
                        const esc = content
                            .replace(/`/g, "\\`")
                            .replace(/\$\{/g, "\\${");
                        return [
                            "(function(root){",
                            "  root.OpenSeadragon = root.OpenSeadragon || {};",
                            "  // Full inlined worker source (libs + core)",
                            "  root.OpenSeadragon.__MVT_WORKER_SOURCE__ = `",
                            esc,
                            "`;",
                            "})(typeof self !== 'undefined' ? self : window);"
                        ].join("\n");
                    }
                },
                src: ["build/openseadragon/mvt-worker.js"],
                dest: "build/openseadragon/mvt-worker.inline.js"
            },
            fabricWorkerPre: {
                options: { sourceMap: false, banner: "" },
                src: fabricWorkerDeps,
                dest: "build/openseadragon/fabric-worker.js"
            },
            fabricWorkerPost: {
                options: {
                    process: function (content/*, srcPath*/) {
                        // Escape backticks and ${ in template literals
                        const esc = content
                            .replace(/`/g, "\\`")
                            .replace(/\$\{/g, "\\${");
                        return [
                            "(function(root){",
                            "  root.OpenSeadragon = root.OpenSeadragon || {};",
                            "  // Full inlined worker source (libs + core)",
                            "  root.OpenSeadragon.__FABRIC_WORKER_SOURCE__ = `",
                            esc,
                            "`;",
                            "})(typeof self !== 'undefined' ? self : window);"
                        ].join("\n");
                    }
                },
                src: ["build/openseadragon/fabric-worker.js"],
                dest: "build/openseadragon/fabric-worker.inline.js"
            },
            dist: {
                // keep your existing dist concat; just ensure the inline is appended:
                src: ["<banner>"].concat(sources).concat([
                    "build/openseadragon/mvt-worker.inline.js",
                    "build/openseadragon/fabric-worker.inline.js"
                ]),
                dest: distribution
            }
        },
        replace: {
            cleanPaths: {
                src: ['build/openseadragon/*.map'],
                overwrite: true,
                replacements: [
                    {
                        from: /build\/openseadragon\//g,
                        to: ''
                    }
                ]
            }
        },
        uglify: {
            options: {
                preserveComments: false,
                banner: banner,
                compress: {
                    sequences: false,
                    /* eslint-disable camelcase */
                    join_vars: false
                },
                sourceMap: true,
                sourceMapName: 'build/openseadragon/flex-renderer.min.js.map',
                sourceMapIn: 'build/openseadragon/flex-renderer.js.map'
            },
            openseadragon: {
                src: distribution,
                dest: minified
            }
        },
        compress: {
            zip: {
                options: {
                    archive: "build/releases/" + packageDirName + ".zip",
                    level: 9
                },
                files: [
                   { expand: true, cwd: "build/", src: [ packageDirName + "/**" ] }
                ]
            },
            tar: {
                options: {
                    archive: "build/releases/" + packageDirName + ".tar.gz",
                    level: 9
                },
                files: [
                   { expand: true, cwd: "build/", src: [ packageDirName + "/**" ] }
                ]
            }
        },
        qunit: {
            normal: {
                options: {
                    urls: [ "http://localhost:8000/test/test.html" + moduleFilter ],
                    timeout: 10000,
                    puppeteer: {
                        headless: 'new'
                    }
                },
            },
            coverage: {
                options: {
                    urls: [ "http://localhost:8000/test/coverage.html" + moduleFilter ],
                    coverage: {
                        src: ['src/*.js'],
                        htmlReport: coverageDir + '/html/',
                        instrumentedFiles: 'instrumented/src/',
                        baseUrl: '.',
                        disposeCollector: true
                    },
                    timeout: 10000
                }
            },
            all: {
                options: {
                    timeout: 10000
                }
            }
        },
        connect: {
            server: {
                options: {
                    port: 8000,
                    base: {
                        path: ".",
                        options: {
                            stylesheet: 'style.css'
                        }
                    }
                }
            }
        },
        watch: {
            files: [ "Gruntfile.js", "src/**/*.js" ],
            tasks: "watchTask"
        },
        eslint: {
            options: {
                overrideConfigFile: '.eslintrc.json'
            },
            target: sources
        },
        "git-describe": {
            options: {
                failOnError: false
            },
            build: {}
        },
        gitInfo: "unknown",
        instrument: {
          files: sources,
          options: {
              lazy: false,
              basePath: 'instrumented/'
          }
        },
        reloadTasks: {
            rootPath: "instrumented/src/"
        },
        storeCoverage: {
            options: {
                dir: coverageDir,
                'include-all-sources': true
              }
         },
        makeReport: {
          src: "coverage/**/*.json",
          options: {
              type: [ "lcov", "html" ],
              dir: coverageDir,
              print: "detail"
          }
      }
    });

    grunt.event.on("qunit.coverage", function(coverage) {
        const reportPath = coverageDir + "/coverage.json";

        // Create the coverage file
        grunt.file.write(reportPath, JSON.stringify(coverage));
    });

    // Copy:build task.
    // Copies icon files into the appropriate location in the build folder
    grunt.registerTask("copy:build", function() {
        grunt.file.recurse("icons", function(abspath, rootdir, subdir, filename) {
            grunt.file.copy(abspath, "build/openseadragon/icons/" + (subdir ? (subdir + "/") : "") + filename);
        });
    });

    // ----------
    // Copy:package task.
    // Creates a directory tree to be compressed into a package.
    grunt.registerTask("copy:package", function() {
        grunt.file.recurse("build/openseadragon", function(abspath, rootdir, subdir, filename) {
            const dest = packageDir +
                (subdir ? subdir + "/" : '/') +
                filename;
            grunt.file.copy(abspath, dest);
        });
        grunt.file.copy("changelog.txt", packageDir + "changelog.txt");
        grunt.file.copy("LICENSE.txt", packageDir + "LICENSE.txt");
    });

    // ----------
    // Copy:release task.
    // Copies the contents of the build folder into the release folder.
    grunt.registerTask("copy:release", function() {
        grunt.file.recurse("build", function(abspath, rootdir, subdir, filename) {
            if (subdir === 'releases') {
                return;
            }

            const dest = releaseRoot +
                (subdir ? subdir + "/" : '/') +
                filename;

            grunt.file.copy(abspath, dest);
        });
    });

    // ----------
    // Bower task.
    // Generates the Bower file for site-build.
    grunt.registerTask("bower", function() {
        const path = "../site-build/bower.json";
        const data = grunt.file.readJSON(path);
        data.version = packageJson.version;
        grunt.file.write(path, JSON.stringify(data, null, 2) + "\n");
    });

    // ----------
    // Watch task.
    // Called from the watch feature; does a full build or a minbuild, depending on
    // whether you used --min on the command line.
    grunt.registerTask("watchTask", function() {
        if (grunt.option('min')) {
            grunt.task.run("minbuild");
        } else {
            grunt.task.run("build");
        }
    });

    // ----------
    // Build task.
    // Cleans out the build folder and builds the code and images into it, checking lint.
    grunt.registerTask("build", [
        "clean:build", "git-describe", "eslint",
        "concat:mvtWorkerPre", "concat:mvtWorkerPost",
        "concat:fabricWorkerPre", "concat:fabricWorkerPost",
        "concat:dist", "uglify",
        "replace:cleanPaths", "copy:build"
    ]);

    // ----------
    // Minimal build task.
    // For use during development as desired. Creates only the unminified version.
    grunt.registerTask("minbuild", [
        "git-describe", "concat", "copy:build"
    ]);

    // ----------
    // Test task.
    // Builds and runs unit tests.
    grunt.registerTask("test", ["build", "connect", "qunit:normal"]);

    // ----------
    // Coverage task.
    // Outputs unit test code coverage report.
    grunt.registerTask("coverage", ["clean:coverage", "instrument", "connect", "qunit:coverage", "makeReport"]);

    // ----------
    // Package task.
    // Builds and creates the .zip and .tar.gz files.
    grunt.registerTask("package", ["build", "copy:package", "compress", "clean:package"]);

    // ----------
    // Publish task.
    // Cleans the built files out of the release folder and copies newly built ones over.
    grunt.registerTask("publish", ["package", "clean:release", "copy:release", "bower"]);

    // ----------
    // Dev task.
    // Builds, fires up a server and watches for changes.
    grunt.registerTask("dev", ["build", "connect", "watch"]);

    // ----------
    // Default task.
    // Does a normal build.
    grunt.registerTask("default", ["build"]);
};
