<?php
/**
 * Template Name: 誘致したい方
 * 施設オーナー・誘致希望者向けランディングページ
 *
 * @package FlavorStreet
 */

get_header();
?>

<main class="fs-main">

	<!-- ページヒーロー -->
	<section class="fs-page-hero">
		<div class="fs-page-hero__bg">
			<?php if ( has_post_thumbnail() ) : ?>
				<?php the_post_thumbnail( 'fs-hero', array( 'class' => 'fs-page-hero__image' ) ); ?>
			<?php else : ?>
				<div class="fs-page-hero__image fs-page-hero__image--placeholder" style="background-image: url('<?php echo fs_placeholder_img( 1920, 600, '誘致ページヒーロー画像 1920x600' ); ?>')"></div>
			<?php endif; ?>
			<div class="fs-page-hero__overlay"></div>
		</div>
		<div class="fs-page-hero__content fs-container">
			<p class="fs-page-hero__label">For Space Owners</p>
			<h1 class="fs-page-hero__title">キッチンカーを誘致したい方へ</h1>
			<p class="fs-page-hero__subtitle">空きスペースにキッチンカーを呼んで、新たな価値を創出しませんか</p>
		</div>
	</section>

	<!-- メリット -->
	<section class="fs-merit fs-section">
		<div class="fs-container">
			<div class="fs-section-header">
				<span class="fs-section-header__en">Merit</span>
				<h2 class="fs-section-header__title">キッチンカー誘致のメリット</h2>
			</div>

			<div class="fs-merit__grid">
				<div class="fs-merit__card">
					<div class="fs-merit__icon">
						<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--fs-primary)" stroke-width="1.5"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
					</div>
					<h3 class="fs-merit__title">導入費用ゼロ</h3>
					<p class="fs-merit__text">初期費用・月額費用は一切かかりません。リスクなしでスタートできます。</p>
				</div>

				<div class="fs-merit__card">
					<div class="fs-merit__icon">
						<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--fs-primary)" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
					</div>
					<h3 class="fs-merit__title">集客・賑わい創出</h3>
					<p class="fs-merit__text">キッチンカーが来ることで人の流れが生まれ、施設全体の活性化につながります。</p>
				</div>

				<div class="fs-merit__card">
					<div class="fs-merit__icon">
						<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--fs-primary)" stroke-width="1.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a4 4 0 0 0-8 0v2"/><circle cx="12" cy="15" r="2"/></svg>
					</div>
					<h3 class="fs-merit__title">運営は全ておまかせ</h3>
					<p class="fs-merit__text">キッチンカーの選定から日々の運営管理まで、すべて当社が対応いたします。</p>
				</div>

				<div class="fs-merit__card">
					<div class="fs-merit__icon">
						<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--fs-primary)" stroke-width="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
					</div>
					<h3 class="fs-merit__title">安心の衛生管理</h3>
					<p class="fs-merit__text">保健所の営業許可を持つ出展者のみが登録。衛生基準を徹底しています。</p>
				</div>
			</div>
		</div>
	</section>

	<!-- 導入事例（写真ギャラリー） -->
	<section class="fs-invite-cases fs-section fs-section--gray">
		<div class="fs-container">
			<div class="fs-section-header">
				<span class="fs-section-header__en">Cases</span>
				<h2 class="fs-section-header__title">導入事例</h2>
				<p class="fs-section-header__subtitle">さまざまな場所でキッチンカーが活躍しています</p>
			</div>

			<div class="fs-invite-cases__grid">
				<?php
				$case_types = array(
					array( 'title' => 'オフィスビル', 'desc' => 'ランチタイムに従業員の満足度UP' ),
					array( 'title' => '商業施設', 'desc' => '週末の集客力を強化' ),
					array( 'title' => 'マンション', 'desc' => '住民サービスとして高評価' ),
					array( 'title' => '公園・広場', 'desc' => '地域の憩いの場を創出' ),
					array( 'title' => '病院・大学', 'desc' => '食のバリエーションを拡充' ),
					array( 'title' => 'イベント会場', 'desc' => 'フェスや催事を盛り上げ' ),
				);

				foreach ( $case_types as $idx => $case ) :
				?>
					<div class="fs-invite-cases__card">
						<div class="fs-invite-cases__image">
							<!-- ★ 事例写真を後から挿入 -->
							<img src="<?php echo fs_placeholder_img( 600, 400, $case['title'] . ' 写真' ); ?>" alt="<?php echo esc_attr( $case['title'] ); ?>の導入事例" loading="lazy">
						</div>
						<div class="fs-invite-cases__body">
							<h3><?php echo esc_html( $case['title'] ); ?></h3>
							<p><?php echo esc_html( $case['desc'] ); ?></p>
						</div>
					</div>
				<?php endforeach; ?>
			</div>
		</div>
	</section>

	<!-- 誘致の流れ -->
	<section class="fs-invite-flow fs-section">
		<div class="fs-container">
			<div class="fs-section-header">
				<span class="fs-section-header__en">Flow</span>
				<h2 class="fs-section-header__title">誘致までの流れ</h2>
			</div>

			<div class="fs-flow__steps">
				<div class="fs-flow__step">
					<div class="fs-flow__step-num">01</div>
					<div class="fs-flow__step-body">
						<h4>お問い合わせ・ヒアリング</h4>
						<p>スペースの広さ・立地条件・ご希望を詳しくお聞かせください。</p>
					</div>
				</div>
				<div class="fs-flow__step">
					<div class="fs-flow__step-num">02</div>
					<div class="fs-flow__step-body">
						<h4>現地調査・プラン提案</h4>
						<p>実際にスペースを確認し、最適な運営プランをご提案いたします。</p>
					</div>
				</div>
				<div class="fs-flow__step">
					<div class="fs-flow__step-num">03</div>
					<div class="fs-flow__step-body">
						<h4>契約・キッチンカー選定</h4>
						<p>ご要望に合った厳選キッチンカーをマッチングします。</p>
					</div>
				</div>
				<div class="fs-flow__step">
					<div class="fs-flow__step-num">04</div>
					<div class="fs-flow__step-body">
						<h4>運営開始・継続サポート</h4>
						<p>導入後も定期的な振り返りと改善提案を行います。</p>
					</div>
				</div>
			</div>
		</div>
	</section>

	<!-- CTA -->
	<section class="fs-page-cta fs-section fs-section--gray">
		<div class="fs-container">
			<div class="fs-page-cta__inner">
				<h2>まずは無料でご相談ください</h2>
				<p>導入費用ゼロ・月額費用ゼロでキッチンカーを誘致できます</p>
				<div class="fs-page-cta__buttons">
					<a href="<?php echo esc_url( home_url( '/contact/' ) ); ?>" class="fs-btn fs-btn--accent fs-btn--large">
						無料相談はこちら
						<span class="fs-btn__arrow">&rarr;</span>
					</a>
				</div>
			</div>
		</div>
	</section>

</main>

<?php get_footer(); ?>
