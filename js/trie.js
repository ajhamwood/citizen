class Trie {
  tree = {};
  put (key, value, tree = this.tree) {
    let l = key.length, prefix;
    while (l--) {
      prefix = key.substr(0, l + 1);
      if (tree[prefix]) {
        if (!Object.keys(tree[prefix]).length) tree[prefix][""] = {};
        return this.put(key.substr(l + 1), value, tree[prefix])
      }
    }
    l = key.length;
    const siblings = Object.keys(tree).filter(k => k !== "$value"),
          siblingFound = siblings.some(sib => {
            let s = 0, commonPrefix;
            do if (sib[s] !== key[s]) {
              if (s > 1) commonPrefix = sib.substr(0, s - 1);
              break
            } while (s++ < l);
            if (commonPrefix) {
              tree[commonPrefix] = {};
              this.put(sib.substr(s - 1), value, tree[commonPrefix]);
              tree[commonPrefix][sib.substr(s - 1)] = tree[sib];
              this.put(key.substr(s - 1), value, tree[commonPrefix]);
              delete tree[sib];
              return true
            }
          });
    if (!siblingFound) tree[key] = { $value: value }
  }
  get (key, tree = this.tree, matchedPrefix = "") {
    let l = key.length, matches = [];
    while (l--) {
      const prefix = key.substr(0, l + 1);
      if (tree[prefix]) {
        const suffix = key.substr(l + 1);
        return this.get(suffix, tree[prefix], matchedPrefix + prefix)
      }
    }
    l = key.length;
    const siblings = Object.keys(tree).filter(k => k !== "$value");
    siblings.some(sib => {
      let s = l;
      if (s !== 0) matches = matches.concat(this.values(tree[sib], matchedPrefix + sib))
      while (s--) if (sib.substr(0, s + 1) === key.substr(0, s + 1)) {
        matches = matches.concat(this.values(tree[sib], matchedPrefix + sib));
        return true
      }
    })
    if (siblings.length !== 0 && key.length !== 0) matches.push(tree.$value);
    return matches
  }
  values (tree = this.tree, matchedPrefix = "") {
    const keys = Object.keys(tree).filter(k => k !== "$value"), matches = [];
    if (keys.length) keys.some(k => {
      if (Object.keys(tree[k]).length) {
        matches = matches.concat(this.values(tree[k], matchedPrefix + k));
        return
      }
      if (tree[k].$value) matches.push(tree[k].$value)
    });
    else if (tree.$value) matches.push(tree.$value);
    return matches
  }
  async init (items) {
    const hash = async msg => fromBuf(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(msg))).toString(16).padStart(40, "0");
    // const hashes = await Promise.all(items.map(v => hash(v)));
    // for (const [i, item] of items.map((v, i) => [i, v]).sort(([i], [j]) => hashes[i] > hashes[j]))
    //   this.put(hashes[i], item)
    for (const item of items) this.put(await hash(item), item)
    return this
  }
}