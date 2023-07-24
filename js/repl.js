var repl = new $.Machine({
      TC: null, debounce: null, debounceTime: 500, selectEnd: null,
      history: { past: [], cur: { code: $("#source").value, highlight: localStorage.getItem("replHighlight") }, future: [] },
      syntaxLabels: [ "ws", "encl", "ident", "atom", "piBinder", "pi", "lamBinder", "lam", "nameImpl", "let" ]
    });

$.targets({
  repl: {
    // BUG: undo breaks highlighting
    // TODO: focus source -> show cursor line/column numbers in bottom right, select -> show range
    // TODO: select -> type "(" or "{" -> enclosure
    editorParse (e) { // Doesn't capture insertReplacementText input events
      const debounceTime = typeof e === "undefined" ? 0 : this.debounceTime,
            highlightEl = $("#highlight"), sourceEl = $("#source");
      clearTimeout(this.debounce);
      this.debounce = setTimeout(async () => {  // disable/enable run
        let source = sourceEl.value, err;
        try {
          const { highlight, normalForm } = await VM().import({ code: sourceEl.value });
          if (highlight.length !== source.length) throw new Error();
          this.TC = normalForm;
          localStorage.setItem("highlight", { code: sourceEl.value, highlight });
          this.history.cur.highlight = highlight;
          this.emit("updateHighlight", highlight)
        } catch (e) { err = e }
        if (err) {
          let span = document.createElement("span");
          span.dataset.label = "ws";
          span.innerText = source;
          highlightEl.innerHTML = "";
          highlightEl.append(span)
        }
        highlightEl.scrollTop = sourceEl.scrollTop;
      }, debounceTime);
  
      if (typeof e === "undefined") return;
      if (e.inputType !== "historyUndo" && e.inputType !== "historyRedo") {
        this.history.future = [];
        if ("highlight" in this.history.cur) this.history.past.push(this.history.cur);
        this.history.cur = { code: sourceEl.value }
      } else if (e.inputType === "historyRedo" && this.history.future.length) {
        this.history.past.push(this.history.cur);
        const { code, highlight } = this.history.cur = this.history.future.pop();
        source.value = code;
        this.emit("updateHighlight", highlight)
      } else if (e.inputType === "historyUndo" && this.history.past.length) {
        this.history.future.push(this.history.cur);
        const { code, highlight } = this.history.cur = this.history.past.pop();
        source.value = code;
        this.emit("updateHighlight", highlight)
      }

      if (highlightEl.children.length === 0) {
        switch (e.inputType) {
          case "insertFromPaste":
          case "insertText":
            const span = document.createElement("span");
            span.dataset.label = "ws"
            span.innerText = this.history.cur.code;
            highlightEl.appendChild(span)
        }
      } else {
        let offsetEnd, str, span;
        const offsetStart = sourceEl.selectionStart - (e.data?.length ?? 0), range = document.createRange(), tmpRange = document.createRange(),
              findSpan = (off, brs = 0) => $.all("#highlight > *").find(el => {
                tmpRange.setEndAfter(el);
                brs += el.innerText.split("\n").length - 1;
                offsetEnd = tmpRange.toString().length + brs;
                return offsetEnd > off
              });
        range.setStartBefore(highlightEl.firstChild);
        range.setEndAfter(highlightEl.lastChild);
        tmpRange.setStartBefore(highlightEl.firstChild);
        switch (e.inputType) {

          case "insertFromPaste":
          case "insertFromDrop":
          case "insertText":
            if (sourceEl.selectionEnd === sourceEl.value.length) {
              if (this.selectEnd !== null) {
                span = findSpan(offsetStart);
                str = span.innerText;
                while (span !== highlightEl.lastChild) highlightEl.lastChild.remove();
                span.innerText = str.substring(0, str.length - offsetEnd + offsetStart).replaceAll("\n", "<br>");
              }
              span = highlightEl.lastChild;
              if (span.dataset.label === "ws") span.innerText += e.data;
              else {
                const spant = document.createElement("span");
                spant.dataset.label = "ws";
                spant.innerText = e.data;
                highlightEl.appendChild(spant)
              }
            } else {
              span = findSpan(offsetStart);
              str = span.innerText;
              const pos = str.length - offsetEnd + offsetStart, len = this.selectEnd === null ? 0 : this.selectEnd - offsetStart,
                    spanEnd = this.selectEnd === null ? span : findSpan(this.selectEnd); // Repeated work
              if (span === spanEnd) {
                if (span.dataset.label === "ws") span.innerHTML = str.substring(0, pos).replaceAll("\n", "<br>") + e.data + str.substring(pos + len).replaceAll("\n", "<br>");
                else {
                  const spanl = document.createElement("span"),
                        spant = document.createElement("span"),
                        spanr = document.createElement("span");
                  spanl.dataset.label = spanr.dataset.label = span.dataset.label;
                  spant.dataset.label = "ws";
                  spanl.innerText = str.substring(0, pos).replaceAll("\n", "<br>");
                  spanr.innerText = str.substring(pos + len).replaceAll("\n", "<br>");
                  spant.innerText = e.data;
                  span.replaceWith(spanl, spant, spanr)
                }
              } else {
                const strEnd = spanEnd.innerText, posEnd = strEnd.length - offsetEnd + this.selectEnd;
                if (posEnd !== 0) spanEnd.innerHTML = strEnd.substring(posEnd).replaceAll("\n", "<br>");
                while (span !== spanEnd.previousSibling) spanEnd.previousSibling.remove();
                if (pos === 0) (span = span.previousSibling).nextSibling.remove();
                else span.innerHTML = str.substring(0, pos).replaceAll("\n", "<br>");
  
                if (span.dataset.label === "ws" && spanEnd.dataset.label === "ws") {
                  span.innerHTML += e.data + spanEnd.innerHTML;
                  spanEnd.remove()
                } else if (span.dataset.label === "ws") span.innerText += e.data
                else if (spanEnd.dataset.label === "ws") spanEnd.innerText = e.data + spanEnd.innerText
                else {
                  const spant = document.createElement("span");
                  spant.dataset.label = "ws"
                  spant.innerText = e.data;
                  highlightEl.insertBefore(spant, spanEnd)
                }
              }
            }
            break;

          case "deleteContentBackward":
          case "deleteContentForward":
          case "deleteByDrag":
          case "deleteByCut": // Requires offsetStart < this.selectEnd
            span = findSpan(offsetStart);
            str = span.innerText;
            const pos = str.length - offsetEnd + offsetStart, len = this.selectEnd === null ? 1 : this.selectEnd - offsetStart,
                  spanEnd = this.selectEnd === null ? span :
                    this.selectEnd === sourceEl.value.length ? undefined : findSpan(this.selectEnd); // Repeated work
            if (span === spanEnd) span.innerHTML = str.substring(0, pos).replaceAll("\n", "<br>") + str.substring(pos + len).replaceAll("\n", "<br>");
            else {
              if (spanEnd === undefined) while (span !== highlightEl.lastChild) highlightEl.lastChild.remove();
              else {
                let strEnd = spanEnd.innerText, posEnd = strEnd.length - offsetEnd + this.selectEnd;
                if (posEnd !== 0) spanEnd.innerHTML = strEnd.substring(posEnd).replaceAll("\n", "<br>");
                while (span !== spanEnd.previousSibling) spanEnd.previousSibling.remove();
              }
              if (pos === 0) span.remove();
              else span.innerHTML = str.substring(0, pos).replaceAll("\n", "<br>");
            }
            break;

          case "historyUndo":
            if (this.history.past.length) {
              this.history.future.push(this.history.cur);
              let ix = this.history.past.findIndex(({ code }) => code === sourceEl.value);
              let { code, highlight } = this.history.cur = this.history.past[ix];
              this.history.past = this.history.past.slice(0, ix);
              sourceEl.value = code;
              this.emit("updateHighlight", highlight)
            }

        }
      }
      this.selectEnd = $("#source").selectionStart === $("#source").selectionEnd ? null : $("#source").selectionEnd;
    },
  
    async editorRun (memory) {
      const log = $("#log");
      let term, type, ctx, err;
      try { ({ term, type, ctx } = await this.TC.run(memory)) } catch (e) { err = e.message }
      log.childNodes.length && $.load("hr", "#log");
      log.appendChild(document.createTextNode(err ? err :
        ((...res) => res.join(/\r\n?|\n/g.test(res.join('')) ? '\n\n' : '\n'))("type: " + type.toString(ctx), "term: " + term.toString(ctx))));
      log.scroll(0, 1e6)
    },
  
    updateHighlight (labelling) {
      if (typeof labelling === "undefined") {
        const span = document.createElement("span");
        span.dataset.label = "ws";
        span.innerText = $("#source").value;
        $("#highlight").replaceChildren(span)
      } else {
        const source = $("#source").value, highlightEl = $("#highlight");
        let prev = -1, text = "", span = null;
        highlightEl.innerHTML = "";
        for (let i = 0, label; i < labelling.length; i++) {
          label = parseInt(labelling[i]);
          if (label !== prev) {
            if (span !== null) [text, span.innerText] = ["", text];
            prev = label;
            span = document.createElement("span");
            span.dataset.label = this.syntaxLabels[label];
            highlightEl.append(span);
          }
          text += source[i]
        }
        if (span !== null) span.innerText = text;
      }
    },
  
    select () { this.selectEnd = $("#source").selectionEnd },
    deselect () { this.selectEnd = null }
  }
})