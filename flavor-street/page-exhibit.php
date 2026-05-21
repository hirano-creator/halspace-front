<?php
/**
 * Template Name: 出展したい方
 * 出展者向けランディングページ
 *
 * @package FlavorStreet
 */

get_header();
?>

<main class="fs-main">

	<!-- ページヒーロー -->
	<section class="fs-page-hero">
		<div class="fs-page-hero__bg">
			<!-- ★ 背景画像は管理画面のアイキャッチ画像から設定 -->
			<?php if ( has_post_thumbnail() ) : ?>
				<?php the_post_thumbnail( 'fs-hero', array( 'class' => 'fs-page-hero__image' ) ); ?>
			<?php else : ?>
				<div class="fs-page-hero__image fs-page-hero__image--placeholder" style="background-image: url('<?php echo fs_placeholder_img( 1920, 600, '出展者向けヒーロー画像 1920x600' ); ?>')"></div>
			<?php endif; ?>
			<div class="fs-page-hero__overlay"></div>
		</div>
		<div class="fs-page-hero__content fs-container">
			<p class="fs-page-hero__label">For Kitchen Car Owners</p>
			<h1 class="fs-page-hero__title">キッチンカーで出展したい方へ</h1>
			<p class="fs-page-hero__subtitle">全国の出展スポットからあなたにぴったりの場所が見つかります</p>
		</div>
	</section>

	<!-- 特徴 -->
	<section class="fs-features fs-section">
		<div class="fs-container">
			<div class="fs-section-header">
				<span class="fs-section-header__en">Features</span>
				<h2 class="fs-section-header__title">選ばれる3つの理由</h2>
			</div>

			<div class="fs-features__grid">
				<div class="fs-features__item">
					<div class="fs-features__image">
						<!-- ★ 写真挿入スロット -->
						<img src="<?php echo fs_placeholder_img( 600, 400, '特徴1 写真' ); ?>" alt="豊富な出展場所" loading="lazy">
					</div>
					<div class="fs-features__body">
						<span class="fs-features__num">01</span>
						<h3>全国500ヶ所以上の出展場所</h3>
						<p>オフィス街、商業施設、マンションエントランスなど、多彩なロケーションからお選びいただけます。</p>
					</div>
				</div>

				<div class="fs-features__item fs-features__item--reverse">
					<div class="fs-features__image">
						<img src="<?php echo fs_placeholder_img( 600, 400, '特徴2 写真' ); ?>" alt="手厚いサポート" loading="lazy">
					</div>
					<div class="fs-features__body">
						<span class="fs-features__num">02</span>
						<h3>出展から売上向上まで手厚いサポート</h3>
						<p>経験豊富なスタッフがメニュー構成や出展戦略のアドバイスまで一貫してサポートします。</p>
					</div>
				</div>

				<div class="fs-features__item">
					<div class="fs-features__image">
						<img src="<?php echo fs_placeholder_img( 600, 400, '特徴3 写真' ); ?>" alt="最短7日で出展" loading="lazy">
					</div>
					<div class="fs-features__body">
						<span class="fs-features__num">03</span>
						<h3>最短7日後から出展可能</h3>
						<p>スピーディーな審査と手続きで、お申し込みから最短7日で出展を開始できます。</p>
					</div>
				</div>
			</div>
		</div>
	</section>

	<!-- 動画セクション -->
	<section class="fs-video-section fs-section fs-section--gray">
		<div class="fs-container">
			<div class="fs-section-header">
				<span class="fs-section-header__en">Movie</span>
				<h2 class="fs-section-header__title">出展の様子</h2>
			</div>
			<div class="fs-video-section__wrapper">
				<!-- ★ 動画挿入スロット：YouTube埋め込みまたはMP4 -->
				<div class="fs-video-section__placeholder">
					<div class="fs-video-section__placeholder-inner">
						<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#6C757D" stroke-width="1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
						<p>動画をここに挿入<br><small>YouTube埋め込みコードまたはMP4ファイルを設定してください</small></p>
					</div>
				</div>
			</div>
		</div>
	</section>

	<!-- 出展者の声 -->
	<section class="fs-testimonials fs-section">
		<div class="fs-container">
			<div class="fs-section-header">
				<span class="fs-section-header__en">Voice</span>
				<h2 class="fs-section-header__title">出展者の声</h2>
			</div>

			<div class="fs-testimonials__grid">
				<?php for ( $i = 1; $i <= 3; $i++ ) : ?>
					<div class="fs-testimonials__card">
						<div class="fs-testimonials__avatar">
							<!-- ★ 出展者の写真 -->
							<img src="<?php echo fs_placeholder_img( 100, 100, "写真{$i}" ); ?>" alt="出展者 <?php echo $i; ?>">
						</div>
						<div class="fs-testimonials__body">
							<p class="fs-testimonials__quote">「ここにお客様の声が入ります。実際の出展者からいただいたコメントを掲載してください。」</p>
							<p class="fs-testimonials__name">出展者名 <?php echo $i; ?></p>
							<p class="fs-testimonials__detail">○○キッチンカー / エリア名</p>
						</div>
					</div>
				<?php endfor; ?>
			</div>
		</div>
	</section>

	<!-- CTA -->
	<section class="fs-page-cta fs-section">
		<div class="fs-container">
			<div class="fs-page-cta__inner">
				<h2>まずは無料で出展場所を探してみませんか？</h2>
				<p>お気軽にお問い合わせください。経験豊富なスタッフがご案内いたします。</p>
				<div class="fs-page-cta__buttons">
					<a href="<?php echo esc_url( home_url( '/contact/' ) ); ?>" class="fs-btn fs-btn--primary fs-btn--large">
						お問い合わせはこちら
						<span class="fs-btn__arrow">&rarr;</span>
					</a>
				</div>
			</div>
		</div>
	</section>

</main>

<?php get_footer(); ?>
