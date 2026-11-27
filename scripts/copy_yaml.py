"""Read content/copy.yaml: a small YAML subset (nested mappings, "key: value", "key: |" text blocks, # comments).
Stdlib only. Raises ValueError with a line number when something doesn't fit."""
import json, sys

def parse(text):
    lines = text.replace('\t', '    ').split('\n')
    root, stack = {}, [(-1, None)]   # (indent, dict)
    stack[0] = (-1, root)
    i = 0
    while i < len(lines):
        raw = lines[i]; i += 1
        s = raw.strip()
        if not s or s.startswith('#'):
            continue
        ind = len(raw) - len(raw.lstrip(' '))
        while stack and ind <= stack[-1][0]:
            stack.pop()
        if not stack:
            raise ValueError(f'line {i}: indenting does not line up')
        parent = stack[-1][1]
        if ': ' in s:
            key, val = s.split(': ', 1)
        elif s.endswith(':'):
            key, val = s[:-1], ''
        else:
            raise ValueError(f'line {i}: expected "name: text" but found {s!r}')
        key, val = key.strip(), val.strip()
        if key in parent:
            raise ValueError(f'line {i}: "{key}" appears twice')
        if val == '|':                      # text block: following lines indented deeper
            block = []
            while i < len(lines) and (not lines[i].strip() or len(lines[i]) - len(lines[i].lstrip(' ')) > ind):
                block.append(lines[i]); i += 1
            while block and not block[-1].strip():
                block.pop()
            pad = min((len(b) - len(b.lstrip(' ')) for b in block if b.strip()), default=0)
            parent[key] = '\n'.join(b[pad:] if b.strip() else '' for b in block)
        elif val == '':
            parent[key] = {}
            stack.append((ind, parent[key]))
        else:
            if len(val) >= 2 and val[0] == val[-1] and val[0] in '"\'':
                val = val[1:-1]
            parent[key] = val
    return root

if __name__ == '__main__':
    print(json.dumps(parse(open(sys.argv[1], encoding='utf8').read()), ensure_ascii=False, indent=1))
