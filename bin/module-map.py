#!/usr/bin/env python3
"""Project the public module map into static reading paths. No network or deps."""
import argparse
from html import escape
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent


def core_cards(data):
    cards = []
    for number, module in enumerate(data['modules'], 1):
        m = {key: escape(value, quote=True) for key, value in module.items()}
        cards.append(f'''<article class="module-row" id="{m['id']}" data-core-module="{m['id']}">
  <span class="row-number" aria-hidden="true">{number:02}</span>
  <div class="row-copy"><a class="module-destination" href="{m['human']}"><h3>{m['title']}</h3><p>{m['purpose']}</p><span class="row-arrow" aria-hidden="true">↗</span></a>
  <details class="row-details"><summary>Scope &amp; effects</summary><p class="row-meta">{m['status']}</p><p>{m['scope']}</p><p>{m['effect']}</p><p>{m['recovery']}</p></details></div>
</article>''')
    return '\n'.join(cards)


def build_cards(data):
    groups = []
    for number, group in enumerate(data['buildGroups'], 1):
        cards = []
        for item in group['items']:
            i = {key: escape(value, quote=True) for key, value in item.items()}
            cards.append(f'''<article class="build-item"><div><h3><a href="{i['human']}">{i['title']} <span aria-hidden="true">↗</span></a></h3><p>{i['note']}</p></div><span class="row-meta">{i['status']}</span></article>''')
        groups.append(f'''<details class="build-group" id="{escape(group['id'])}" data-build-group="{escape(group['id'])}"><summary><span class="row-number" aria-hidden="true">{number:02}</span><h2>{escape(group['title'])}</h2><span class="group-count">{len(cards)} paths</span></summary><div class="build-items">{''.join(cards)}</div></details>''')
    return '\n'.join(groups)


def replace_region(text, name, content):
    start, end = f'<!-- module-map:{name}:start -->', f'<!-- module-map:{name}:end -->'
    if text.count(start) != 1 or text.count(end) != 1:
        raise ValueError(f'expected one {name} projection region')
    return re.sub(re.escape(start) + r'.*?' + re.escape(end),
                  lambda _: start + '\n' + content + '\n' + end, text, flags=re.S)


def navigation(data, audience, web):
    view = data['audiences'][audience]
    items = ''.join(f'<a class="nav-essential" href="{escape(x["href"], quote=True)}">{escape(x["title"])}</a>' for x in view['primary'])
    switch = view['switch']
    items += f'<a class="nav-essential nav-audience" href="{escape(switch["href"], quote=True)}" aria-label="{escape(switch["title"], quote=True)}">{"Agent" if audience == "human" else "Human"}</a>'
    return (f'<nav class="{"site-nav" if web else "topnav"}" aria-label="Primary">'
            f'<a class="{"wordmark" if web else "logo"}" href="{view["home"]}">agenttool</a>'
            f'<div class="{"links" if web else "nav-actions"}">{items}</div>'
            '<button class="toggle" id="tg" type="button" aria-label="Toggle dawn / night mode" hidden>☾ night</button></nav>')


def outputs(root=ROOT):
    data = json.loads((root / 'apps/_shared/module-map.json').read_text())
    if data['schema'] != 'agenttool-module-map/v1':
        raise ValueError('unsupported module map schema')
    ids = [m['id'] for m in data['modules']]
    if len(set(ids)) != len(ids):
        raise ValueError('duplicate module id')
    for link in [m[field] for m in data['modules'] for field in ('human', 'agent', 'read')]:
        if not link.startswith('https://'):
            raise ValueError('module links must use HTTPS')
    result = {'apps/_shared/module-map.js': '/* Generated from module-map.json by bin/module-map.py. */\nwindow.AgentToolModuleMap = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n'}
    result['apps/_shared/nav.html'] = '''<!-- Generated navigation reference; not a runtime include.
Edit apps/_shared/module-map.json, then run python3 bin/module-map.py --write.
Declare data-audience="human" or "agent" on each page's html element.
The static navigation remains usable without scripts. Appearance is separate.
mode.js/theme.js load module-map.js then estate.js for search and core navigation.
See docs/INTERACTION.md. Standalone script-free artifacts keep their own shell.
-->\n<!-- Human overview -->\n''' + navigation(data, 'human', True) + '\n<!-- Agent reference -->\n' + navigation(data, 'agent', False) + '\n'
    for path, name, content in [('apps/web/index.html', 'core', core_cards(data)), ('apps/web/build.html', 'build', build_cards(data))]:
        result[path] = replace_region((root / path).read_text(), name, content)
    for area in ('web', 'docs', 'dashboard'):
        for path in sorted((root / 'apps' / area).glob('*.html')):
            name = path.relative_to(root).as_posix()
            source = result.get(name, path.read_text())
            if '<!-- module-map:navigation:start -->' not in source:
                continue
            audience = re.search(r'<html[^>]*data-audience="(human|agent)"', source)
            if not audience:
                raise ValueError('missing declared audience: ' + name)
            result[name] = replace_region(source, 'navigation', navigation(data, audience[1], area == 'web'))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--write', action='store_true')
    mode.add_argument('--check', action='store_true')
    args = parser.parse_args()
    stale = []
    for name, content in outputs().items():
        path = ROOT / name
        if args.write:
            path.write_text(content)
        elif not path.exists() or path.read_text() != content:
            stale.append(name)
    if stale:
        parser.exit(1, 'Module map projections need --write: ' + ', '.join(stale) + '\n')
    print('Module map projections ' + ('written.' if args.write else 'match.'))


if __name__ == '__main__':
    main()
