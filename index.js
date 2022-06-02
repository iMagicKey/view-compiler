const fs = require('fs')
const path = require('path')

class ViewCompiler {
    constructor() {
        this.yieldRegex = /\@yield\('(.+)'\)/g
        this.extendsRegex = /\@extends\('(.+)'\)/
        this.sectionRegex = "@section\\('(.+)'\\)\n([\\s\\S]+)\n@endsection"
        this.particleRegex = /\@particle\('(.+)'\)/g
        this.tagRegex = /(<%%|%%>|<%=|<%-|<%_|<%#|<%|%>|-%>|_%>)/

        this.openTagSymbol = '<'
        this.closeTagSymbol = '>'
        this.tagSymbol = '%'

        this.parentView = null
        this.sections = {}
        this.contents = ''
        this.source = ''
    }

    getViewAbsolutePath(file) {
        return path.resolve(`${ViewCompiler.viewsDir}/${file}.ejs`)
    }
    
    particleFormat(data) {
        return data.replace(this.particleRegex, (full, match) => {
            let particlePath = this.getViewAbsolutePath(match)
            
            if (fs.existsSync(particlePath)) {
                return this.particleFormat(fs.readFileSync(particlePath, 'utf8'))
            } else {
                console.warn(`Warning: particle "${match}" not found in "${path}"`)
                return ''
            }
        })
    }

    render(path, data = {}, isParent = false) {
        let viewPath = this.getViewAbsolutePath(path)

        if (fs.existsSync(viewPath) == false) {
            throw new Error(`Error: view "${match}" not found!`)
        }

        this.contents = fs.readFileSync(viewPath, 'utf8')
        this.parseDependencies()

        // Particle include
        this.contents = this.particleFormat(this.contents)

        if (this.parentView) {
            let compliler = new ViewCompiler()
 
            this.contents = compliler.render(this.parentView, data, true)

            this.contents = this.contents.replace(this.yieldRegex, (full, match) => {
                if (match in this.sections) {
                    return this.particleFormat(this.sections[match])
                } else {
                    console.warn(`Warning: section "${match}" not found in "${path}" for parent "${this.parentView}"`)
                    return ''
                }
            })
        }

        if (isParent == false) {
            this.contents = this.contents.replace(this.yieldRegex, (full, match) => {
                return ''
            })
            
            let func = this.сompile()

            let additionalFunctions = ViewCompiler.additionalFunctions ?? {}
            let defaultFunctions = {
                escapeFunction: this.escapeFunction
            }

            let runData = {
                ...data,
                ...additionalFunctions,
                ...defaultFunctions
            }

            return func(runData)
        } 

        return this.contents
    }

    escapeFunction(markup) {
        const encodeChar = function(char) {
            const encodeRules = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&#34;',
                "'": '&#39;'
            }

            return encodeRules[char] || char
        }

        return markup == undefined ? '' : String(markup).replace(/[&<>'"]/g, encodeChar)
    }

    сompile() {
        this.generateSource()
        var prependSection = ''
        var appendSection = ''

        prependSection += 'var __output = ""\n'
        prependSection += 'Object.assign(this, arguments[0])\n'
        prependSection += 'function __append(string) {\n'
        prependSection += '    if (string !== undefined && string !== null) {\n'
        prependSection += '        __output += string\n'
        prependSection += '    }\n'
        prependSection += '}\n'

        appendSection += 'return __output;' + '\n';
        this.source = prependSection + this.source + appendSection;

        let func = new Function(this.source)

        return func
    }

    generateSource () {
        let parts = this.parseViewContents()

        if (parts && parts.length) {
            parts.forEach((line, index) => {
                let closeTag

                let isTag = line.indexOf(this.openTagSymbol + this.tagSymbol) === 0
                let isNotEscaped = line.indexOf(this.openTagSymbol + this.tagSymbol + this.tagSymbol) !== 0

                if (isTag && isNotEscaped) {
                    closeTag = parts[index + 2]
                    let defaultCloseTag = this.tagSymbol + this.closeTagSymbol
                    let minusCloseTag = '-' + this.tagSymbol + this.closeTagSymbol
                    let underscoreCloseTag = '_' + this.tagSymbol + this.closeTagSymbol

                    if ([defaultCloseTag, minusCloseTag, underscoreCloseTag].includes(closeTag) == false) {
                        throw new Error(`Could not find matching close tag for "${line}"`)
                    }
                }

                this.scanLine(line)
            })
        }
    }

    scanLine(line) {
        let defaultOpenTag = this.openTagSymbol + this.tagSymbol
        let defaultCloseTag = this.tagSymbol + this.closeTagSymbol

        switch (line) {
            case defaultOpenTag:
            case defaultOpenTag + '_':
                this.mode = ViewCompiler.MODE_EVAL
                break

            case defaultOpenTag + '=':
                this.mode = ViewCompiler.MODE_ESCAPED
                break

            case defaultOpenTag + '-':
                this.mode = ViewCompiler.MODE_RAW
                break

            case defaultOpenTag + '#':
                this.mode = ViewCompiler.MODE_COMMENT
                break

            case defaultOpenTag + this.tagSymbol:
                this.mode = ViewCompiler.MODE_LITERAL
                this.source += `__append("${line.replace(defaultOpenTag + this.tagSymbol, defaultOpenTag)}")\n`
                break

            case defaultCloseTag:
            case '-' + defaultCloseTag:
            case '_' + defaultCloseTag:
                if (this.mode == ViewCompiler.MODE_LITERAL) {
                    this._addOutput(line);
                }
                this.mode = null
                this.truncate = line.indexOf('-') === 0 || line.indexOf('_') === 0;
                break

            case this.tagSymbol + defaultCloseTag:
                this.mode = ViewCompiler.MODE_LITERAL
                this.source += `__append("${line.replace(this.tagSymbol + defaultCloseTag, defaultCloseTag)}")\n`
                break

            default:
                // In script mode, depends on type of tag
                if (this.mode) {
                    // If '//' is found without a line break, add a line break.
                    if ([ViewCompiler.MODE_EVAL, ViewCompiler.MODE_ESCAPED, ViewCompiler.MODE_RAW].includes(this.mode)) {
                        if (line.lastIndexOf('//') > line.lastIndexOf('\n')) {
                            line += '\n'
                        }
                    }
                            
                    switch (this.mode) {
                        // Just executing code
                        case ViewCompiler.MODE_EVAL:
                            this.source += `${line}\n`
                            break

                        // Exec, esc, and output
                        case ViewCompiler.MODE_ESCAPED:
                            this.source += `__append(escapeFunction(${this.stripSemi(line)}))\n`
                            // this.source += '    ; __append(escapeFunction(' + this.stripSemi(line) + '))' + '\n';
                            break
                            
                        // Exec and output
                        case ViewCompiler.MODE_RAW:
                            this.source += `__append(${this.stripSemi(line)})\n`
                            // this.source += '    ; __append(' + this.stripSemi(line) + ')' + '\n';
                            break

                        case ViewCompiler.MODE_COMMENT:
                            // Do nothing
                            break

                        // Literal <%% mode, append as raw output
                        case ViewCompiler.MODE_LITERAL:
                            this._addOutput(line)
                            break
                    }
                } else {
                    this._addOutput(line)
                }
        }
    }

    _addOutput(line) {
        if (this.truncate) {
            // Only replace single leading linebreak in the line after
            // -%> tag -- this is the single, trailing linebreak
            // after the tag that the truncation mode replaces
            // Handle Win / Unix / old Mac linebreaks -- do the \r\n
            // combo first in the regex-or
            line = line.replace(/^(?:\r\n|\r|\n)/, '')
            this.truncate = false
        }

        if (!line) {
            return line
        }

        // Preserve literal slashes
        line = line.replace(/\\/g, '\\\\');

        // Convert linebreaks
        line = line.replace(/\n/g, '\\n');
        line = line.replace(/\r/g, '\\r');

        // Escape double-quotes - this will be the delimiter during execution
        line = line.replace(/"/g, '\\"');
        this.source += `__append("${line}")\n`
        // this.source += '    ; __append("' + line + '")' + '\n';
    }

    stripSemi(str){
        return str.replace(/;(\s*$)/, '$1')
    }

    parseViewContents() {
        let contents = this.contents
        let match = this.tagRegex.exec(contents)

        let result = []

        while (match) {
            if (match.index !== 0) {
                result.push(contents.substring(0, match.index))
                contents = contents.slice(match.index)
            }

            result.push(match[0])
            contents = contents.slice(match[0].length)

            match = this.tagRegex.exec(contents)
        }

        if (contents) {
            result.push(contents)
        }

        return result
    }

    parseDependencies() {
        let extendsMatch = this.contents.match(this.extendsRegex)
        if (extendsMatch) {
            let [match, parentView] = extendsMatch

            if (parentView) {
                this.parentView = parentView
            }
        }

        let sections = Array.from(this.contents.matchAll(this.sectionRegex))
        sections.forEach((section) => {
            let [match, name, content] = section
            this.sections[name] = content
        })
    }

    static setViewsDir(viewsDir) {
        ViewCompiler.viewsDir = viewsDir
    }

    static addFunction(name, fn) {
        ViewCompiler.additionalFunctions = ViewCompiler.additionalFunctions ?? {}
        ViewCompiler.additionalFunctions[name] = fn
    }
}

ViewCompiler.MODE_EVAL = 'eval'
ViewCompiler.MODE_ESCAPED = 'escaped'
ViewCompiler.MODE_RAW = 'raw'
ViewCompiler.MODE_COMMENT = 'comment'
ViewCompiler.MODE_LITERAL = 'literal'

module.exports = ViewCompiler