"""Import only the already published franchise guide, without executing its HTML.

Usage: python scripts/import-instruction.py --source PATH_TO_INSTRUKCIYA_CHECKOUT
The generated bundle is versioned with FRchat. This script never writes to GitHub.
"""
import argparse
from datetime import datetime
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent.parent
TAGS = {'p', 'div', 'span', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'ul', 'ol',
        'li', 'a', 'br', 'details', 'summary', 'fieldset', 'legend', 'label',
        'input', 'pre', 'button'}
VOID = {'br', 'input', 'meta', 'link', 'img', 'hr'}


class Parser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = {'tag': 'root', 'attrs': {}, 'children': []}
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = {'tag': tag, 'attrs': dict(attrs), 'children': []}
        self.stack[-1]['children'].append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i]['tag'] == tag:
                self.stack = self.stack[:i]
                break

    def handle_data(self, data):
        self.stack[-1]['children'].append(data)


def walk(node):
    if isinstance(node, dict):
        yield node
        for child in node['children']:
            yield from walk(child)


def text(node):
    if isinstance(node, str):
        return node
    return ' '.join(text(child) for child in node['children'])


def tidy(value):
    return re.sub(r'\s+', ' ', value).strip()


def clean(node):
    if isinstance(node, str):
        return [node.replace('→', '').replace('↗', '').replace('↓', '')]
    if node['tag'] in {'script', 'style', 'noscript'}:
        return []
    children = [item for child in node['children'] for item in clean(child)]
    if node['tag'] not in TAGS:
        return children
    attrs = {key: value for key, value in node['attrs'].items()
             if key in {'class', 'id', 'href', 'data-copy', 'type'} and value is not None}
    return [{'tag': node['tag'], 'attrs': attrs, 'children': children}]


DESCRIPTIONS = {
    'registration': 'Сроки регистрации, документы, проверка СБ и шапка сообщения для HR.',
    'franchise-department': 'К кому обращаться и как взаимодействовать с франшизным отделом.',
    'hr-department': 'Обучение агентов, подбор сотрудников, резервирование и передача кандидатов.',
    'new-buildings': 'Контакты отдела, регистрация на платформах и работа с новостройками.',
    'administrator-training': 'Обучение, ввод в работу и сопровождение администратора офиса.',
    'it-department': 'HelpDesk, доступы, Avito PRO и обслуживание техники.',
    'pr-department': 'Рекламные материалы, корпоративная продукция, фото- и видеосъёмка.',
    'payments': 'Ответственные за оплаты, отчётность, мероприятия и обучение.',
    'important-contacts': 'Телефоны руководителей, отделов и специалистов компании.',
    'groups': 'Рабочие группы франшизы, новостроек, поиска клиентов и ипотеки в MAX.',
    'documents': 'Анкета кандидата с согласием и актуальные офферы на подбор.',
    'offices': 'Адреса, собственники и телефоны действующих офисов сети.',
}
CATEGORIES = {'important-contacts': 'reference-contacts', 'offices': 'reference-offices',
              'payments': 'reference-payments', 'documents': 'document-contracts'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    args = parser.parse_args()
    source = args.source.resolve()
    remote = subprocess.check_output(['git', 'remote', 'get-url', 'origin'], cwd=source, text=True).strip()
    if remote != 'https://github.com/LeSauteur/Instrukciya.git':
        raise SystemExit('Expected the canonical published Instrukciya repository.')
    if subprocess.check_output(['git', 'status', '--porcelain'], cwd=source).strip():
        raise SystemExit('Source checkout must be clean; import a reviewable committed version.')
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip()
    subprocess.run(['git', 'merge-base', '--is-ancestor', revision, 'origin/main'], cwd=source, check=True)
    source_html = (source / 'index.html').read_text(encoding='utf-8-sig')
    version_date = datetime.strptime(re.search(r'Обновлено (\d{2}\.\d{2}\.\d{4})', source_html)[1], '%d.%m.%Y').date().isoformat()
    parsed = Parser()
    parsed.feed(source_html)
    articles = []
    for section in walk(parsed.root):
        if section['tag'] != 'section' or 'content-page' not in section['attrs'].get('class', '').split():
            continue
        slug = section['attrs']['id']
        title = next(tidy(text(n)) for n in walk(section) if n['tag'] == 'h1')
        if slug == 'documents':
            title = 'Анкета и офферы'
        children = [n for n in section['children'] if not (isinstance(n, dict) and n['attrs'].get('class') == 'page-heading')]
        body = [item for child in children for item in clean(child)]
        articles.append({'slug': slug, 'title': title, 'category_id': CATEGORIES.get(slug, 'reference-instructions'),
                         'description': DESCRIPTIONS[slug], 'body': body, 'text': tidy(text(section))})
    assert len(articles) == 12
    groups = json.loads((source / 'assets/groups.json').read_text(encoding='utf-8-sig'))
    offices = json.loads((source / 'assets/offices.json').read_text(encoding='utf-8-sig'))
    contact_parser = Parser()
    contact_parser.feed((source / 'contacts.html').read_text(encoding='utf-8-sig'))
    contacts = []
    for node in walk(contact_parser.root):
        if node['attrs'].get('class') != 'contact-card':
            continue
        name = next(tidy(text(n)) for n in walk(node) if n['tag'] == 'h2')
        contacts.append({'name': name,
                         'department': next(tidy(text(n)) for n in walk(node) if n['attrs'].get('class') == 'eyebrow'),
                         'role': next(tidy(text(n)) for n in walk(node) if n['tag'] == 'p'),
                         'phones': [n['attrs']['href'][4:] for n in walk(node) if n['tag'] == 'a' and n['attrs'].get('href', '').startswith('tel:')]})
    assert (len(groups), len(offices), len(contacts)) == (43, 68, 19)
    files = []
    output = ROOT / 'public/instruction-files'
    output.mkdir(parents=True, exist_ok=True)
    for name, title, description in [
        ('anketa-2026.doc', 'Анкета и согласие', 'Анкета претендента на работу и согласие на обработку персональных данных · 2026'),
        ('agent-offer.docx', 'Подбор агентов', 'Оффер передачи кандидатов: 2,5% с оборота сделки агента.'),
        ('admin-offer.docx', 'Подбор администратора', 'Оффер на подбор, обучение и сопровождение администратора.')]:
        data = (source / 'documents' / name).read_bytes()
        shutil.copyfile(source / 'documents' / name, output / name)
        files.append({'name': name, 'title': title, 'description': description,
                      'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    for article in articles:
        extra = groups if article['slug'] == 'groups' else offices if article['slug'] == 'offices' else contacts if article['slug'] == 'important-contacts' else files if article['slug'] == 'documents' else []
        article['text'] += ' ' + json.dumps(extra, ensure_ascii=False)
    bundle = {'schema_version': 1, 'source_url': 'https://lesauteur.github.io/Instrukciya/',
              'source_revision': revision, 'version_date': version_date, 'articles': articles,
              'groups': groups, 'offices': offices, 'contacts': contacts, 'files': files}
    destination = ROOT / 'src/data/instruction.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(f'Imported {len(articles)} articles, {len(groups)} MAX groups, {len(offices)} offices, {len(contacts)} contacts and {len(files)} files from {revision[:7]}')


if __name__ == '__main__':
    main()
