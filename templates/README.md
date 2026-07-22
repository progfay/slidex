# 使い回しスライド(templates/)

`templates/` にはデッキをまたいで使い回すスライドの原本を置く。
`slides/` と同じ階層深度なので `../assets/` `../design-system/` の
相対参照がそのまま動き、単体でブラウザで開いて確認できる。

- `templates/self-intro.html` — 自己紹介スライド。使うときは
  `slides/NN-self-intro.html` にコピーして manifest に加え、
  箇条書きだけ発表テーマに寄せて差し替える(名前・SNS はそのまま)。
  このスライドは移植元の見た目を踏襲する意図的な規約例外
  (生値の配色・独自フォント指定)を含むが、原本の状態を維持する
