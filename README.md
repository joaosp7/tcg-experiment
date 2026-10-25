# Build Divide card archive

Acervo fechado de 7.734 cartas. O scraper original coleta os dados japoneses em
`data/cards.db` e as imagens em `images/`. O catálogo Next.js fica em `app/web`.

## Tradução para inglês

O script `translate_cards.py` usa a biblioteca padrão do Python, sem dependências
adicionais. O provedor padrão é **DeepSeek**, com modelo **`deepseek-flash`**,
Chat Completions, thinking desativado e saída JSON validada localmente.
Configure `DEEPSEEK_API_KEY` no ambiente ou em `.env`. `DEEPSEEK_MODEL` permite
selecionar outro modelo. A integração não usa `OPENAI_API_KEY` como fallback.

OpenAI continua disponível com `--provider openai`: Responses API, modelo padrão
`gpt-6-luna`, reasoning `low`, JSON Schema estrito e `store=false`.
O modelo OpenAI pode ser alterado com `OPENAI_MODEL` ou `--model`.
Use `--provider deepseek|openai` ou `TRANSLATION_PROVIDER` para escolher o provedor;
sem configuração, o padrão é DeepSeek. A sessão do Codex não configura as chaves.

Copie `.env.example` para `.env` e preencha `DEEPSEEK_API_KEY` localmente. O arquivo
é ignorado pelo Git. Variáveis do ambiente têm precedência sobre `.env`.

Execute da raiz do projeto:

```sh
# Inspeção sem API ou mudanças no banco (também funciona antes de migrar).
uv run python translate_cards.py run --dry-run --limit 100

# Backup consistente do SQLite e migração reaplicável.
uv run python translate_cards.py migrate

# Tipos, custos, atributos conhecidos e campos vazios, sem API.
uv run python translate_cards.py run --all --rules-only

# Piloto: até 100 cartas pendentes distribuídas por tipo e jogo.
# Limite de 500 chamadas lógicas; cada chamada pode ter até 3 retries.
uv run python translate_cards.py run --provider deepseek --limit 100 --max-requests 500

# Relatório com cobertura, candidatos, japonês original e erros.
uv run python translate_cards.py report --output data/translation-report.json

# Após revisar o piloto: continuar o acervo, em blocos de até 500 chamadas.
uv run python translate_cards.py run --all --max-requests 500

# Acervo completo: agrupar 12 campos por requisição, com até 8 requisições em paralelo.
uv run python translate_cards.py run --provider deepseek --all --workers 8 --batch-size 12 --max-output-tokens 16384 --max-requests 2000

# Falhas e candidatos sinalizados não são reenviados sem opção explícita.
uv run python translate_cards.py run --all --retry-failed
uv run python translate_cards.py run --limit 20 --retry-review
```

`--limit` conta cartas, não campos ou tokens. Uma carta pode gerar várias chamadas.
`--max-output-tokens` limita a saída de cada chamada (incluindo raciocínio); não é
um teto financeiro. O resumo informa tokens de entrada/saída das respostas desta
execução. Não processar o acervo completo antes de avaliar qualidade e consumo no
piloto. Reexecutar retoma os campos pendentes, sem retraduzir resultados atuais.

No modo agrupado, textos idênticos com o mesmo contexto são enviados uma única vez,
inclusive quando o resultado precisa de revisão. Cada campo é validado separadamente;
respostas com chaves faltando são rejeitadas. Só a thread principal grava no SQLite.
O consumo de uma resposta agrupada é registrado uma vez, no primeiro campo do lote;
os demais compartilham `response_id` sem duplicar os tokens no relatório.
Se a API informar `Retry-After` acima de 30 segundos, a execução para de agendar
requisições e salva os resultados já recebidos. Ajuste os limites do projeto ou
aguarde o prazo informado; depois retome com `--retry-failed`. Não é necessário
reiniciar a tradução inteira. Esgotamento de quota/faturamento também interrompe
as chamadas, sem repetir o restante do acervo.
`--card-id 1 --card-id 2` restringe cartas e `--fields name effect_text` restringe campos.
Opções globais `--db` e `--glossary` devem vir antes do subcomando.

### Dados e revisão

São adicionadas `name_en`, `card_type_en`, `attributes_en`, `effect_text_en`,
`flavor_text_en`, `cost_en` e `set_name_en`. Os campos japoneses são preservados.
Antes da primeira migração, um snapshot completo é salvo em
`data/cards.before-translation-<timestamp>.db`. Guarde esse backup.

`translation_jobs` registra a origem, contexto, configuração, candidato, modelo,
método, consumo da última tentativa e estado de cada campo:

- `validated`: passou nas verificações automáticas; **não significa revisão humana**.
- `needs_review`: candidato guardado, sem publicar o novo texto.
- `failed`: resposta incompleta, recusa ou erro; nenhum candidato novo é publicado.
- `reviewed`: tradução revisada/editada explicitamente pelo usuário ou pelo agente
  e protegida de reexecuções. O estado não certifica revisão humana; consulte as notas.
- `empty`: origem vazia, sem necessidade de tradução.

Falhas ou candidatos pendentes preservam uma tradução já publicada quando o texto
japonês não mudou. Sem tradução anterior, a coluna `_en` fica `NULL`. Mudanças no
original invalidam o valor anterior. Isso evita que limites da API removam conteúdo
já disponível durante uma atualização do glossário.

O cache exige igualdade de texto, contexto, glossário, instruções, provedor e modelo.
Não usa somente nome ou `card_group_id` para reaproveitar efeitos.
Trocar apenas o provedor/modelo preserva traduções válidas. Para regenerá-las,
use `--retranslate`. Mudanças no glossário/instruções reprocessam traduções
automáticas na próxima execução; os valores existentes permanecem publicados até
o campo ser processado. Candidatos `needs_review` só são reenviados com
`--retry-review`, mesmo após trocar provedor ou glossário. Mudanças não substituem
revisões explícitas. Para alterar uma revisão, use `review` novamente.

A migração adiciona `provider` a `translation_jobs` com backup e preserva os
registros legados da OpenAI. Novas traduções e erros identificam seu provedor;
tokens DeepSeek (`prompt_tokens`/`completion_tokens`) são normalizados no relatório.
DeepSeek garante JSON válido, mas não o JSON Schema da aplicação: a estrutura,
tipos, chaves dos lotes e marcadores continuam sendo verificados localmente.
Respostas vazias, truncadas ou interrompidas não são publicadas. Não há troca
automática de provedor ao atingir limite ou erro de autenticação.

```sh
uv run python translate_cards.py review --card-id 3 --field effect_text --text 'Draw 1 card.'
```

O exemplo demonstra o comando; não é a tradução real da carta 3. O comando valida
a edição e usa `--allow-warnings` somente quando um humano aceita explicitamente
as advertências. Candidatos não aprovados aparecem no relatório JSON.

A revisão editorial dos 10 candidatos do piloto está registrada em
`reviews/pilot-review-2026-10-24.json`, com original, candidato anterior, decisão,
justificativa e fontes. Não é uma localização oficial nem uma certificação de regras.

`translation_glossary.json` contém convenções iniciais do projeto, **não uma
localização oficial**. Os atributos ainda não mapeados são enviados à IA com os
termos conhecidos como referência. Adicione grafias de personagens em `names` e
traduções de símbolos em `markers` após revisar o piloto. Para listar a origem:

```sh
uv run python translate_cards.py inventory
```

Os marcadores `⁅…⁆` são protegidos com placeholders. Símbolos conhecidos recebem
a notação do glossário; símbolos desconhecidos mantêm o japonês e exigem revisão.
Há validação de quantidades numéricas, sinais, presença/ordem de placeholders,
separadores de atributos, japonês residual e tamanho anormal. Isso não prova
equivalência das regras: condições, alvos e negações ainda precisam de revisão.

### Catálogo

```sh
cd app/web
pnpm install
pnpm dev
```

Node >=22.16. Antes de `dev`/`build`, `scripts/sync-db.mjs` usa o backup online do
SQLite para gerar um snapshot consistente, incluindo conteúdo do WAL, e substituir
`app/web/data/cards.db`. Execute a sincronização com o servidor parado; reinicie ou
refaça o build após traduzir. O snapshot versionado permite publicar o catálogo
sem a chave OpenAI ou a tabela de originais externa ao app.

O site exibe inglês com fallback por campo para japonês, pesquisa nos dois idiomas
e mantém valores japoneses estáveis nas opções dos filtros. Também aceita valores
em inglês nas URLs, como `?type=Unit&attribute=Human`, incluindo cartas que ainda
não tenham tradução, mas compartilhem o mesmo tipo ou atributo original.
Traduções vazias ou compostas apenas por espaços recorrem ao japonês.
A busca inclui nome, efeito, flavor, tipo, atributo, coleção, custo e ilustrador.
A página de detalhe oferece
os originais japoneses e identifica as traduções como não oficiais. Bancos antigos,
sem colunas `_en`, continuam funcionando.

Em **My decks** (`/decks`), crie, renomeie e exclua decks. No catálogo,
selecione cartas em páginas ou filtros diferentes e use **Add to deck**.
O painel **Build a deck** inicia desligado: ative seu toggle para exibir os
controles de deck, a seleção nas cartas e o campo **Copies**. Marcar uma carta
seleciona uma cópia; informar uma quantidade positiva também seleciona a carta.
Zero ou desmarcar remove a carta da seleção. Desligar o painel oculta os controles
e preserva a seleção enquanto você navega; recarregar reinicia o modo e a seleção.
O campo de cópias aceita apenas inteiros não negativos. Valores inválidos exibem
um erro e bloqueiam **Add to deck** até serem corrigidos ou a seleção ser limpa.
A seleção permanece durante a navegação e é limpa após adicionar as cartas.
No deck, ajuste quantidades, remova cartas ou mova cópias para outro deck.
Adicionar novamente uma carta incrementa sua quantidade; o catálogo não é alterado.

Os decks são salvos automaticamente no `localStorage`, na chave
`script-leo:decks:v1`, contendo apenas IDs e quantidades das cartas.
Não há autenticação: os dados pertencem ao perfil do navegador e à origem do site,
sem sincronização entre dispositivos. Limpar os dados do site apaga os decks.
Abas abertas refletem alterações salvas. Dados inválidos são preservados e exibem
um erro, assim como falhas de gravação; não há validação de regras de composição.
Gravações entre abas são serializadas com Web Locks (HTTPS ou localhost em
navegador compatível); sem esse recurso, a gravação é recusada com uma mensagem.
Falhas na consulta dos detalhes das cartas não impedem editar as quantidades
salvas, remover ou mover cartas. **Retry failed details** tenta novamente apenas
os lotes pendentes, preservando os detalhes já carregados.

### Verificação local

```sh
uv run python -m unittest discover -s tests -v
cd app/web
pnpm test
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

Com o catálogo aberto por `pnpm dev` (Turbopack), a regressão visual das cartas
compara dimensões em sete larguras e testa títulos longos e metadados ausentes:

```sh
# Executar de app/web, com o servidor de desenvolvimento ativo.
npx --yes --package @playwright/cli playwright-cli -s=card-layout open 'http://localhost:3000/?role=ace'
npx --yes --package @playwright/cli playwright-cli -s=card-layout run-code --filename scripts/check-card-layout.mjs
npx --yes --package @playwright/cli playwright-cli -s=card-layout close
```

Os testes Python usam SQLite temporário e respostas OpenAI/DeepSeek simuladas. Não consomem
créditos e não verificam acesso ao modelo nem qualidade linguística real.

Referências: [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna),
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
[DeepSeek API](https://api-docs.deepseek.com/),
[DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode),
[SQLite backup](https://nodejs.org/api/sqlite.html#sqlitebackupsourcedb-path-options).
