'use strict';

var L = (function () {
  function empty () {
    return Object.create(null)
  }

  function populate (arr, obj = empty(), val = true) {
    arr.forEach(x => obj[x] = val);
    return obj
  }

  let escapeable = populate(['"', '\\']), debug;

  let rx_clrf = /\n|\r\n?/,
      rx_token =  /^((\s+)|([a-zA-Z][a-zA-Z0-9_]*[\']*)|([:!$%&*+./<=>\?@\\^|\-~\[\]]{1,5})|(0|[1-9][0-9]*)|([(),;_#"]))(.*)$/,
      rx_digits = /^([0-9]+)(.*)$/,
      rx_hexs = /^[0-9a-fA-F]+(.*)$/;

  function stop_at (err, line, col, info) {
    throw `${err}\nat ${line}:${col}\n${info}`
  }

  function tokenise (source, d) {
    debug = d ? console.log : () => {};
    let lines = source.split(rx_clrf),
        tokens = [], tl = 0,
        line = -1,
        col = 0,
        sourceline = '', char, snippet;

    function nextline () {
      col = 0;
      line++;
      sourceline =lines[line]
    }

    function snip () {
      snippet = snippet.slice(0, -1)
    }

    function nextchar (match) {
      if (match !== undefined && match !== char) return stop_at(char === '' ?
        `missing expected character "${match}"` :
        `unexpected character "${char}" for "${match}"`, line, col - 1)
      if (sourceline) {
        char = sourceline[0];
        sourceline = sourceline.slice(1);
        snippet += char
      }
      else {
        char = '';
        snippet += ' '
      }
      col += 1;
      return char
    }

    function backchar () {
      if (snippet) {
        char = snippet.slice(-1);
        sourceline = char + sourceline;
        col -= 1;
        snip();
      }
      else char = '';
      return char;
    }

    function somedigits (rx) {
      let result = sourceline.match(rx);
      if (result) {
        char = result[1];
        col += char.length;
        sourceline = result[2];
        snippet += char
      }
      else return stop_at('expected digits', line, col)
    }

    function make (id, value, identifier) {
      debug(id, value, identifier)
      let the_token = {id, identifier: Boolean(identifier)};
      if (value !== undefined) the_token.value = value;
      tl = tokens.push(the_token)
    }

    function string () {
      snippet = '';
      return (function next () {
        if (char === '"') {
          snip();
          return make('(string)', snippet);
        }
        else if (char === '') {
          stop_at('unclosed string', line, col)
        }
        else if (char === '\\') {
          nextchar('\\');
          if (char === '') return stop_at('unclosed string', line, col);
          else if (escapeable[char]) nextchar()
        }
        else nextchar()
        return next()
      })()
    }

    function infix () {
      return make('(infix)', snippet, true)
    }

    function number () {
      if (snippet === '0') {
        nextchar()
        if (char === '.') frack();
        else if (char === "x") {
          somedigits(rx_hexs);
          nextchar()
        }
      }
      else {
        nextchar();
        frack()
      }
      if (/[0-9a-zA-Z]/.test(char)) return stop_at(`unexpected character ${char} after number`, line, col - 1);
      backchar();
      return make('(number)', snippet)
    }

    function frack () {
      if (char === ".") {
        somedigits(rx_digits);
        nextchar();
      }
      if (char === "E" || char === "e") {
        nextchar();
        if (char !== "+" && char !== "-") backchar();
        somedigits(rx_digits);
        nextchar();
      }
    }

    function comment () {
      snippet = sourceline;
      sourceline = '';
      return make('(comment)', snippet)
    }

    function punctuation () {
      return make('(punctuation)', snippet, true)
    }

    return (function lex () {
      let result;
      if (!sourceline) {
        nextline();
        if (sourceline === undefined) {
          make('(end)');
          return tokens
        }
        else {
          if (line) make('(newline)');
          return lex()
        }
      }

      result = sourceline.match(rx_token);
      if (!result) {
        return stop_at('unexpected character', line, col, sourceline[0])
      }
      snippet = result[1];
      col += snippet.length;
      sourceline = result[7];

      if (result[2]) return lex();
      else if (result[3]) make(snippet, undefined, true);
      else if (result[4]) infix();
      else if (result[5]) number();
      else if (result[6]) {
        if (snippet === '"') string();
        else if (snippet === '#') comment();
        else punctuation()
      };
      return lex()
    })()
  }

  return { tokenise, empty, populate }
})();


if (typeof module !== 'undefined') module.exports = L
