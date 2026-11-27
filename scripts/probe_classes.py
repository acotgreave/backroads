"""Temporary: print the Wikidata classes and country props of known answers,
so the fastfood/soda/cereal queries can be pointed at the right classes."""
import json, urllib.parse, urllib.request
UA = 'BackroadsQuiz/1.0 (https://backroads.howtospeakdata.com; trivia game build, weekly)'
names = ['Taco Bell','Wendy\'s','Chick-fil-A','Arby\'s','Sonic Drive-In','Cheerios','Froot Loops','Lucky Charms','Frosted Flakes','Cap\'n Crunch','Dr Pepper','Mountain Dew','Coca-Cola','A&W Root Beer','Sprite']
vals = ' '.join('"%s"@en' % n.replace('"','') for n in names)
q = '''SELECT ?t ?item ?cls ?clsLabel ?p17 ?p495 ?ind ?indLabel WHERE { VALUES ?t { %s } ?item rdfs:label ?t; wdt:P31 ?cls.
 OPTIONAL{?item wdt:P17 ?p17} OPTIONAL{?item wdt:P495 ?p495} OPTIONAL{?item wdt:P452 ?ind}
 SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }''' % vals
req = urllib.request.Request('https://query.wikidata.org/sparql?format=json&query=' + urllib.parse.quote(q), headers={'User-Agent': UA, 'Accept': 'application/sparql-results+json'})
for b in json.load(urllib.request.urlopen(req, timeout=60))['results']['bindings']:
    g = lambda k: b.get(k, {}).get('value', '').rsplit('/', 1)[-1]
    print('PROBE', g('t'), g('item'), g('cls'), g('clsLabel'), 'P17=' + g('p17'), 'P495=' + g('p495'), 'ind=' + g('ind'), g('indLabel'), sep=' | ')
